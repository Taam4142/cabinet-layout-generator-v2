import { describe, expect, it } from "vitest";
import {
  clampScale, fitView, MAX_PX_PER_MM, panBy, pinchStep, wheelFactor, zoomAt, zoomLimits,
  type View,
} from "./viewport";

/** Viewport px → drawing units under a view. */
const toDrawing = (v: View, p: { x: number; y: number }) => ({ x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale });

describe("fitView", () => {
  it("fits a tall plate by height and centres it horizontally", () => {
    const v = fitView({ w: 800, h: 1060 }, { w: 1200, h: 700 }, 16);
    expect(v.scale).toBeCloseTo((700 - 32) / 1060, 10);
    expect(v.y).toBeCloseTo(16, 10);
    expect(v.x).toBeCloseTo((1200 - 800 * v.scale) / 2, 10);
  });

  it("fits a wide plate by width and centres it vertically", () => {
    const v = fitView({ w: 2000, h: 500 }, { w: 1000, h: 800 }, 0);
    expect(v.scale).toBeCloseTo(0.5, 10);
    expect(v.x).toBeCloseTo(0, 10);
    expect(v.y).toBeCloseTo((800 - 250) / 2, 10);
  });

  it("degrades to identity on empty sizes instead of NaN/Infinity", () => {
    expect(fitView({ w: 0, h: 100 }, { w: 500, h: 500 })).toEqual({ scale: 1, x: 0, y: 0 });
    expect(fitView({ w: 100, h: 100 }, { w: 0, h: 0 })).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("zoomLimits / clampScale", () => {
  it("allows half-fit out and MAX_PX_PER_MM in", () => {
    expect(zoomLimits(0.6)).toEqual({ min: 0.3, max: MAX_PX_PER_MM });
  });
  it("still allows 2× fit when the fit is already very large", () => {
    expect(zoomLimits(8).max).toBe(16);
  });
  it("clamps both ends", () => {
    const l = { min: 0.5, max: 4 };
    expect(clampScale(0.1, l)).toBe(0.5);
    expect(clampScale(9, l)).toBe(4);
    expect(clampScale(2, l)).toBe(2);
  });
});

describe("zoomAt", () => {
  const limits = { min: 0.1, max: 20 };

  it("keeps the drawing point under the cursor fixed", () => {
    const v: View = { scale: 0.8, x: 40, y: -25 };
    const at = { x: 310, y: 220 };
    const before = toDrawing(v, at);
    const z = zoomAt(v, 1.25, at, limits);
    expect(z.scale).toBeCloseTo(1.0, 10);
    const after = toDrawing(z, at);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("zoom in then out by the same factor returns to the start", () => {
    const v: View = { scale: 1, x: 12, y: 34 };
    const at = { x: 100, y: 200 };
    const back = zoomAt(zoomAt(v, 2, at, limits), 0.5, at, limits);
    expect(back.scale).toBeCloseTo(1, 10);
    expect(back.x).toBeCloseTo(12, 9);
    expect(back.y).toBeCloseTo(34, 9);
  });

  it("at the limit it is a no-op (no drift from a clamped zoom)", () => {
    const v: View = { scale: 20, x: 5, y: 6 };
    expect(zoomAt(v, 2, { x: 300, y: 300 }, limits)).toEqual({ scale: 20, x: 5, y: 6 });
  });
});

describe("panBy", () => {
  it("translates without changing scale", () => {
    expect(panBy({ scale: 2, x: 1, y: 1 }, 10, -5)).toEqual({ scale: 2, x: 11, y: -4 });
  });
});

describe("pinchStep", () => {
  const limits = { min: 0.1, max: 20 };

  it("spreading fingers about a fixed midpoint zooms about that midpoint", () => {
    const v: View = { scale: 1, x: 0, y: 0 };
    const mid = { x: 200, y: 150 };
    const before = toDrawing(v, mid);
    const p = pinchStep(v, { dist: 100, mid }, { dist: 200, mid }, limits);
    expect(p.scale).toBeCloseTo(2, 10);
    const after = toDrawing(p, mid);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("moving both fingers together pans by the midpoint delta", () => {
    const v: View = { scale: 1.5, x: 10, y: 10 };
    const p = pinchStep(v, { dist: 80, mid: { x: 100, y: 100 } }, { dist: 80, mid: { x: 130, y: 90 } }, limits);
    expect(p).toEqual({ scale: 1.5, x: 40, y: 0 });
  });

  it("a zero starting distance does not blow up", () => {
    const v: View = { scale: 1, x: 0, y: 0 };
    expect(pinchStep(v, { dist: 0, mid: { x: 0, y: 0 } }, { dist: 50, mid: { x: 0, y: 0 } }, limits).scale).toBe(1);
  });
});

describe("wheelFactor", () => {
  it("scroll up zooms in, scroll down zooms out, and they are inverses", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100) * wheelFactor(100)).toBeCloseTo(1, 12);
  });
  it("normalises line-mode deltas (Firefox mouse wheel) to pixel-like steps", () => {
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0), 12);
  });
});
