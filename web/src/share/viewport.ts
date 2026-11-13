/**
 * Pure pan/zoom math for the read-only share viewer (no DOM, unit-tested).
 *
 * A View places the drawing inside the viewport: the image's top-left sits at
 * (x, y) viewport px and is drawn at `scale` px per drawing unit (the SVG is
 * rendered at 1 unit = 1 mm, so scale is px-per-mm). Zooming keeps the point
 * under the cursor / pinch-centre fixed, like the editor and GstarCAD.
 */
export type View = { scale: number; x: number; y: number };
export type Size = { w: number; h: number };
export type Point = { x: number; y: number };
export type Limits = { min: number; max: number };

/** Empty margin (px) kept around the drawing when fitting it to the viewport. */
export const FIT_PADDING = 16;
/** One button / key step. */
export const ZOOM_STEP = 1.25;
/**
 * Zoom ceiling in px-per-mm. 10 px/mm puts a 2.5 mm terminal tag at ~25 px —
 * comfortably readable — while keeping the laid-out image a sane size.
 */
export const MAX_PX_PER_MM = 10;

/** Scale + offset that shows the whole drawing centred in the viewport. */
export function fitView(content: Size, viewport: Size, pad = FIT_PADDING): View {
  if (content.w <= 0 || content.h <= 0 || viewport.w <= 0 || viewport.h <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const availW = Math.max(1, viewport.w - 2 * pad);
  const availH = Math.max(1, viewport.h - 2 * pad);
  const scale = Math.min(availW / content.w, availH / content.h);
  return {
    scale,
    x: (viewport.w - content.w * scale) / 2,
    y: (viewport.h - content.h * scale) / 2,
  };
}

/**
 * Allowed zoom range for a given fit scale: zoom out to half the fit, zoom in
 * to MAX_PX_PER_MM — but never less than 2× fit, so a tiny plate can still be
 * enlarged.
 */
export function zoomLimits(fitScale: number): Limits {
  return { min: fitScale * 0.5, max: Math.max(fitScale * 2, MAX_PX_PER_MM) };
}

export function clampScale(scale: number, limits: Limits): number {
  return Math.min(limits.max, Math.max(limits.min, scale));
}

/** Zoom by `factor`, keeping viewport point `at` over the same drawing point. */
export function zoomAt(view: View, factor: number, at: Point, limits: Limits): View {
  const scale = clampScale(view.scale * factor, limits);
  const k = scale / view.scale;
  return { scale, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/**
 * One pinch step: zoom by the change in finger distance about the previous
 * midpoint, then follow the midpoint's movement (two-finger pan).
 */
export function pinchStep(
  view: View,
  prev: { dist: number; mid: Point },
  next: { dist: number; mid: Point },
  limits: Limits,
): View {
  const factor = prev.dist > 0 ? next.dist / prev.dist : 1;
  const zoomed = zoomAt(view, factor, prev.mid, limits);
  return panBy(zoomed, next.mid.x - prev.mid.x, next.mid.y - prev.mid.y);
}

/** Wheel delta → zoom factor (smooth on trackpads, ~1.2× per mouse notch). */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-px * 0.0015);
}
