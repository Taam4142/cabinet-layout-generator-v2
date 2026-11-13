/**
 * Pan/zoom surface for the read-only share viewer.
 *
 * The drawing stays an <img> data URI (shared content can never execute in this
 * page — see ShareViewer). Zoom changes the image's LAID-OUT size rather than a
 * CSS scale, so the browser re-rasterises the vector at every level and stays
 * crisp; pan is a cheap translate. All math lives in the pure, tested
 * ./viewport module.
 *
 * Input: wheel / trackpad = zoom at cursor · drag = pan · double-click = zoom in
 * · pinch = zoom + pan (touch) · keys + − 0 and arrows · the floating buttons.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  fitView, panBy, pinchStep, wheelFactor, zoomAt, zoomLimits, ZOOM_STEP,
  type Point, type Size, type View,
} from "./viewport";

const KEY_PAN_PX = 60;

const btn: React.CSSProperties = {
  minWidth: 34, height: 32, padding: "0 10px", border: "1px solid #d0d5dd", borderRadius: 6,
  background: "#fff", color: "#1f2937", font: "inherit", fontSize: 15, cursor: "pointer",
};

export default function DrawingViewport({ src, content, alt }: { src: string; content: Size; alt: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  // until the user zooms/pans, keep re-fitting on window resize / rotation
  const touched = useRef(false);
  const pointers = useRef(new Map<number, Point>());
  const [dragging, setDragging] = useState(false);

  const fit = useMemo(() => fitView(content, vp), [content, vp]);
  const limits = useMemo(() => zoomLimits(fit.scale), [fit.scale]);
  // listeners registered once read the latest limits through a ref
  const limitsRef = useRef(limits);
  useEffect(() => { limitsRef.current = limits; }, [limits]);

  // track the viewport size
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setVp({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // first view, and re-fit on resize while the user hasn't taken over
  useEffect(() => {
    if (vp.w <= 0 || vp.h <= 0) return;
    if (!touched.current) setView(fit);
  }, [fit, vp]);

  const act = useCallback((fn: (v: View) => View) => {
    touched.current = true;
    setView((v) => (v ? fn(v) : v));
  }, []);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const centre = (): Point => ({ x: vp.w / 2, y: vp.h / 2 });

  const zoomBy = (factor: number, at: Point = centre()) => act((v) => zoomAt(v, factor, at, limits));
  const resetFit = () => { touched.current = false; setView(fit); };

  // wheel must be non-passive to stop the page scrolling — React's onWheel is passive
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      act((v) => zoomAt(v, wheelFactor(e.deltaY, e.deltaMode), at, limitsRef.current));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [act]);

  // keyboard: + / − / 0 and arrows (ignored while typing in a control or with Ctrl/⌘,
  // so the browser's own Ctrl± page zoom still works)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      const el = boxRef.current;
      if (!el) return;
      const c = { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      const L = limitsRef.current;
      let fn: ((v: View) => View) | null = null;
      if (e.key === "+" || e.key === "=") fn = (v) => zoomAt(v, ZOOM_STEP, c, L);
      else if (e.key === "-" || e.key === "_") fn = (v) => zoomAt(v, 1 / ZOOM_STEP, c, L);
      else if (e.key === "ArrowLeft") fn = (v) => panBy(v, KEY_PAN_PX, 0);
      else if (e.key === "ArrowRight") fn = (v) => panBy(v, -KEY_PAN_PX, 0);
      else if (e.key === "ArrowUp") fn = (v) => panBy(v, 0, KEY_PAN_PX);
      else if (e.key === "ArrowDown") fn = (v) => panBy(v, 0, -KEY_PAN_PX);
      if (e.key === "0") { e.preventDefault(); touched.current = false; setView(fitView(content, { w: el.clientWidth, h: el.clientHeight })); return; }
      if (fn) { e.preventDefault(); act(fn); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, content]);

  // pointer: one pointer pans, two pointers pinch
  const pinchOf = (): { dist: number; mid: Point } | null => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // capture keeps the drag alive outside the box; it can throw (pointer
    // already gone) — panning must still work without it
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    pointers.current.set(e.pointerId, local(e));
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prevPt = pointers.current.get(e.pointerId);
    if (!prevPt) return;
    const before = pinchOf();
    const pt = local(e);
    pointers.current.set(e.pointerId, pt);
    if (before) {
      const after = pinchOf()!;
      act((v) => pinchStep(v, before, after, limits));
    } else {
      act((v) => panBy(v, pt.x - prevPt.x, pt.y - prevPt.y));
    }
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  const pct = view && fit.scale > 0 ? Math.round((view.scale / fit.scale) * 100) : 100;

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      aria-label="Drawing viewer. Scroll or pinch to zoom, drag to pan; keys + − 0 and arrows."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={(e) => zoomBy(2, local(e))}
      style={{
        position: "relative", flex: 1, minHeight: 0, overflow: "hidden", outline: "none",
        background: "#eef0f3", touchAction: "none", userSelect: "none",
        cursor: dragging ? "grabbing" : "grab",
      }}
    >
      {view && (
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            position: "absolute", left: 0, top: 0,
            width: content.w * view.scale, height: content.h * view.scale,
            transform: `translate(${view.x}px, ${view.y}px)`, transformOrigin: "0 0",
            background: "#fff", boxShadow: "0 1px 4px rgba(16,24,40,.18)",
            pointerEvents: "none", maxWidth: "none",
          }}
        />
      )}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute", right: 12, bottom: 12, display: "flex", gap: 6, alignItems: "center",
          padding: 6, background: "rgba(255,255,255,.94)", border: "1px solid #e4e7ec", borderRadius: 8,
          boxShadow: "0 1px 3px rgba(16,24,40,.12)", cursor: "default",
        }}
      >
        <button type="button" style={btn} title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
        <span title="Zoom, relative to the whole-drawing fit" style={{ minWidth: 48, textAlign: "center", fontSize: 13, color: "#374151", fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
        <button type="button" style={btn} title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>+</button>
        <button type="button" style={btn} title="Fit the whole drawing (0)" aria-label="Fit the whole drawing" onClick={resetFit}>Fit</button>
      </div>
    </div>
  );
}
