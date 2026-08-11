/**
 * Ink stroke geometry helpers for the canvas surface.
 *
 * `pathFromPoints` (quadratic midpoint smoothing) and `strokeBounds` are
 * ported from the desktop annotation overlay (PickPreload). `normalizePoints`
 * shifts freshly drawn world/screen points to a bounds-local origin so ink
 * nodes can store node-relative points per the canvas contracts.
 */

export interface CanvasStrokePoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasStrokeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Smooth an SVG path through the points with quadratic midpoint curves. */
export function pathFromPoints(points: ReadonlyArray<CanvasStrokePoint>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y} l 0.01 0.01`;
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]!;
    const next = points[index + 1]!;
    path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
  }
  const last = points[points.length - 1]!;
  path += ` L ${last.x} ${last.y}`;
  return path;
}

/**
 * Axis-aligned bounds of a stroke, padded by the stroke width plus a small
 * slop so hit targets and render surfaces cover the full painted area.
 */
export function strokeBounds(
  points: ReadonlyArray<CanvasStrokePoint>,
  strokeWidth: number,
): CanvasStrokeRect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const padding = strokeWidth + 3;
  const left = Math.min(...xs) - padding;
  const top = Math.min(...ys) - padding;
  const right = Math.max(...xs) + padding;
  const bottom = Math.max(...ys) + padding;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Shift points so the minimum point sits at (0, 0) and return the origin the
 * points were shifted by. The origin becomes the ink node's x/y and the
 * shifted points are stored node-relative.
 */
export function normalizePoints(points: ReadonlyArray<CanvasStrokePoint>): {
  points: CanvasStrokePoint[];
  origin: { x: number; y: number };
} {
  if (points.length === 0) return { points: [], origin: { x: 0, y: 0 } };
  const origin = {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
  };
  return {
    points: points.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y })),
    origin,
  };
}
