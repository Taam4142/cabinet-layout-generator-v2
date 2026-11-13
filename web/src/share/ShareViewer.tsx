/**
 * Read-only share-link viewer (Phase 3): rendered instead of the app when the URL
 * carries ?share=<token>. Anonymous — fetches the layout through the exact-token
 * RPC, renders it with THE renderer (toSvg, so it matches the editor and exports
 * exactly), and offers the in-browser PDF/PNG sheet downloads. No editing, no
 * DXF, no service dependency.
 *
 * Layout: a slim header bar + a full-window pan/zoom drawing surface
 * (DrawingViewport), so a large plate is readable down to its part tags and the
 * page works on phones (pinch / drag).
 */
import { useEffect, useMemo, useState } from "react";
import type { LayoutModel, Library } from "../model/types";
import { loadSharedProject } from "../store/projectStore";
import { cloudEnabled } from "../lib/supabaseClient";
import { contentWidth, renderToSvg } from "../render/toSvg";
import { downloadPdf, downloadPng, downloadBomPdf } from "../export/inBrowser";
import type { Paper } from "../render/page";
import { timeAgo } from "../lib/timeAgo";
import DrawingViewport from "./DrawingViewport";

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "ready"; name: string; model: LayoutModel; library: Library; updatedAt: string };

const font = "Arial, Helvetica, sans-serif";
const message: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "18px 22px", fontFamily: font };

export default function ShareViewer({ token }: { token: string }) {
  // no cloud configured → a share token can never resolve
  const [state, setState] = useState<State>(cloudEnabled ? { kind: "loading" } : { kind: "invalid" });
  const [paper, setPaper] = useState<Paper>("A3");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!cloudEnabled) return;
    loadSharedProject(token).then((res) => {
      if (!alive) return;
      setState(res ? { kind: "ready", ...res } : { kind: "invalid" });
    });
    return () => { alive = false; };
  }, [token]);

  // Render the drawing ONCE per loaded layout — not on every zoom/pan/paper/busy
  // re-render (a big plate is a large SVG to build + encode). Shown via an <img>
  // data URI so shared content can never execute anything in this page (defence
  // in depth on top of embedSvg's sanitizer).
  const drawing = useMemo(() => {
    if (state.kind !== "ready") return null;
    const { model, library } = state;
    return {
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderToSvg(model, library, { unitsPerMm: 1 }))}`,
      content: { w: contentWidth(model), h: model.plate.height_mm },
    };
  }, [state]);

  if (state.kind === "loading") return <div style={message}><p>Loading shared layout…</p></div>;
  if (state.kind === "invalid" || !drawing) {
    return (
      <div style={message}>
        <h2>This link isn't valid</h2>
        <p>The share link is wrong, or it was revoked by the project's team.</p>
      </div>
    );
  }

  const { name, model, library, updatedAt } = state;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily: font, color: "#1f2937" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "6px 14px", flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid #e4e7ec", background: "#fff" }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || "Untitled"}</h2>
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            read-only shared view · {model.plate.width_mm}×{model.plate.height_mm} mm · saved {timeAgo(updatedAt)}
          </div>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 14, color: "#374151" }}>Paper{" "}
            <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
              <option value="A4">A4</option><option value="A3">A3</option>
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => run(() => downloadPdf(model, library, paper))}>PDF</button>
          <button type="button" disabled={busy} onClick={() => run(() => downloadPng(model, library, paper))}>PNG</button>
          <button type="button" disabled={busy} onClick={() => run(() => downloadBomPdf(model, library, paper))}>BOM PDF</button>
        </span>
      </header>
      <DrawingViewport src={drawing.src} content={drawing.content} alt={`Layout drawing: ${name || "Untitled"}`} />
      <footer style={{ padding: "6px 16px", fontSize: 12, color: "#6b7280", borderTop: "1px solid #e4e7ec", background: "#fff" }}>
        Shared from Cabinet Layout Generator — this link always shows the latest saved version.
        <span style={{ marginLeft: 8, color: "#9ca3af" }}>Scroll or pinch to zoom · drag to pan · double-click to zoom in</span>
      </footer>
    </div>
  );
}
