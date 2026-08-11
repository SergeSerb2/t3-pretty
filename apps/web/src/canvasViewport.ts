/**
 * Canvas viewport math - pure screen/world transforms, zoom, fit-to-content,
 * and world-space hit-testing for the infinite canvas. No DOM, React, or
 * store access; everything is unit-testable with plain values.
 */
import type { CanvasDocument, CanvasNode } from "@t3tools/contracts";

import {
  localRectOf,
  worldRectOf,
  type CanvasMeasuredSizes,
  type CanvasRect,
} from "./canvasDocSync";

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/** screen = world * scale + (tx, ty) */
export type CanvasViewportTransform = { tx: number; ty: number; scale: number };

export const CANVAS_MIN_SCALE = 0.05;
export const CANVAS_MAX_SCALE = 8;
export const CANVAS_FIT_PADDING = 48;

const clampScale = (scale: number): number =>
  Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, scale));

export function screenToWorld(t: CanvasViewportTransform, point: CanvasPoint): CanvasPoint {
  return { x: (point.x - t.tx) / t.scale, y: (point.y - t.ty) / t.scale };
}

export function worldToScreen(t: CanvasViewportTransform, point: CanvasPoint): CanvasPoint {
  return { x: point.x * t.scale + t.tx, y: point.y * t.scale + t.ty };
}

export function screenRectToWorld(t: CanvasViewportTransform, rect: CanvasRect): CanvasRect {
  const origin = screenToWorld(t, { x: rect.x, y: rect.y });
  return { x: origin.x, y: origin.y, width: rect.width / t.scale, height: rect.height / t.scale };
}

export function worldRectToScreen(t: CanvasViewportTransform, rect: CanvasRect): CanvasRect {
  const origin = worldToScreen(t, { x: rect.x, y: rect.y });
  return { x: origin.x, y: origin.y, width: rect.width * t.scale, height: rect.height * t.scale };
}

function rescaleAtPoint(
  t: CanvasViewportTransform,
  point: CanvasPoint,
  scale: number,
): CanvasViewportTransform {
  if (scale === t.scale) return t;
  return {
    scale,
    tx: point.x - (point.x - t.tx) * (scale / t.scale),
    ty: point.y - (point.y - t.ty) * (scale / t.scale),
  };
}

/**
 * Wheel zoom anchored at a screen point: the world position under the cursor
 * stays fixed while the scale changes exponentially with deltaY.
 */
export function zoomAtPoint(
  t: CanvasViewportTransform,
  point: CanvasPoint,
  deltaY: number,
): CanvasViewportTransform {
  return rescaleAtPoint(t, point, clampScale(t.scale * Math.exp(-deltaY * 0.0015)));
}

/** Explicit-scale zoom (toolbar 100% / +/-) anchored at a screen point. */
export function zoomToScaleAtPoint(
  t: CanvasViewportTransform,
  point: CanvasPoint,
  targetScale: number,
): CanvasViewportTransform {
  return rescaleAtPoint(t, point, clampScale(targetScale));
}

/**
 * Center the content bounds in the viewport at the largest scale that fits
 * with `padding` on every side, never zooming in past 100%. Degenerate or
 * missing bounds center the origin at 100%.
 */
export function fitToContent(
  bounds: CanvasRect | null,
  viewportSize: CanvasSize,
  padding = CANVAS_FIT_PADDING,
): CanvasViewportTransform {
  if (
    !bounds ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !(bounds.width > 0) ||
    !(bounds.height > 0)
  ) {
    return { tx: viewportSize.width / 2, ty: viewportSize.height / 2, scale: 1 };
  }
  const scale = Math.max(
    CANVAS_MIN_SCALE,
    Math.min(
      (viewportSize.width - 2 * padding) / bounds.width,
      (viewportSize.height - 2 * padding) / bounds.height,
      1,
    ),
  );
  return {
    scale,
    tx: (viewportSize.width - bounds.width * scale) / 2 - bounds.x * scale,
    ty: (viewportSize.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

/** Axis-aligned rect spanned by two corner points, in either drag direction. */
export function rectFromPoints(a: CanvasPoint, b: CanvasPoint): CanvasRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export type CanvasResizeHandle = "nw" | "ne" | "sw" | "se";

export interface CanvasResizeOptions {
  /** width / height ratio to preserve; omit for a free resize. */
  aspectRatio?: number;
  minWidth?: number;
  minHeight?: number;
}

/**
 * Rect produced by dragging the corner `handle` to `point` with the opposite
 * corner anchored. The dragged corner clamps at the anchor (no flipping) and
 * at the minimum size; an aspect ratio locks the rect to the dominant axis
 * while keeping the minimums.
 */
export function resizeRectFromHandle(
  start: CanvasRect,
  handle: CanvasResizeHandle,
  point: CanvasPoint,
  options: CanvasResizeOptions = {},
): CanvasRect {
  const minWidth = options.minWidth ?? 16;
  const minHeight = options.minHeight ?? 16;
  const east = handle === "ne" || handle === "se";
  const south = handle === "sw" || handle === "se";
  const anchor = {
    x: east ? start.x : start.x + start.width,
    y: south ? start.y : start.y + start.height,
  };
  let width = Math.max(minWidth, east ? point.x - anchor.x : anchor.x - point.x);
  let height = Math.max(minHeight, south ? point.y - anchor.y : anchor.y - point.y);
  const ratio = options.aspectRatio;
  if (ratio !== undefined && Number.isFinite(ratio) && ratio > 0) {
    if (width / ratio >= height) height = width / ratio;
    else width = height * ratio;
    if (width < minWidth) {
      width = minWidth;
      height = width / ratio;
    }
    if (height < minHeight) {
      height = minHeight;
      width = height * ratio;
    }
  }
  return {
    x: east ? anchor.x : anchor.x - width,
    y: south ? anchor.y : anchor.y - height,
    width,
    height,
  };
}

export const CANVAS_GRID_BASE_STEP = 24;

/**
 * Screen-space dot-grid spacing for a zoom level: the base step scaled by the
 * viewport, folded by powers of two into [12, 48) px so the grid stays legible
 * across the full zoom range instead of collapsing or spreading out.
 */
export function adaptiveGridStep(scale: number, baseStep = CANVAS_GRID_BASE_STEP): number {
  let step = baseStep * scale;
  if (!Number.isFinite(step) || step <= 0) return baseStep;
  while (step < 12) step *= 2;
  while (step >= 48) step /= 2;
  return step;
}

function pointToSegmentDistance(point: CanvasPoint, a: CanvasPoint, b: CanvasPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** True when the point lies within `tolerance` of any stroke segment. */
export function strokeHitTest(
  points: readonly CanvasPoint[],
  point: CanvasPoint,
  tolerance: number,
): boolean {
  if (points.length === 0) return false;
  if (points.length === 1) {
    return Math.hypot(point.x - points[0]!.x, point.y - points[0]!.y) <= tolerance;
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    if (pointToSegmentDistance(point, points[index]!, points[index + 1]!) <= tolerance) return true;
  }
  return false;
}

export interface CanvasHitTestOptions {
  measuredSizes?: CanvasMeasuredSizes;
  /**
   * Hit slop in world units; callers pass screen tolerance divided by the
   * viewport scale. Sizes the frame border band and pads ink strokes.
   */
  tolerance?: number;
  /** Height of the frame label band above the frame's top edge, world units. */
  frameLabelBand?: number;
}

const rectContainsPoint = (rect: CanvasRect, point: CanvasPoint): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

const rectsIntersect = (a: CanvasRect, b: CanvasRect): boolean =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

const rectContainsRect = (outer: CanvasRect, inner: CanvasRect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

function buildChildrenIndex(doc: CanvasDocument): Map<string | null, CanvasNode[]> {
  const byParent = new Map<string | null, CanvasNode[]>();
  for (const node of doc.nodes) {
    const parentKey = node.parentId ?? null;
    const siblings = byParent.get(parentKey);
    if (siblings) siblings.push(node);
    else byParent.set(parentKey, [node]);
  }
  return byParent;
}

/**
 * Topmost node at a world point, or null. Traverses reverse z-order with
 * children above their parents, so a child of a later parent sits above an
 * earlier parent's children. Frames only hit on their border band and label
 * band so clicks over their interior fall through to the content below;
 * images, regions, and notes hit by rect containment; ink hits by segment
 * distance padded with half the stroke width.
 */
export function hitTestPoint(
  doc: CanvasDocument,
  point: CanvasPoint,
  options: CanvasHitTestOptions = {},
): CanvasNode | null {
  const tolerance = options.tolerance ?? 8;
  const frameLabelBand = options.frameLabelBand ?? tolerance * 2;
  const childrenByParent = buildChildrenIndex(doc);

  const hitsNode = (node: CanvasNode, worldX: number, worldY: number): boolean => {
    if (node.type === "frame") {
      const rect = { x: worldX, y: worldY, width: node.width, height: node.height };
      const inLabelBand =
        point.y >= rect.y - frameLabelBand &&
        point.y <= rect.y &&
        point.x >= rect.x &&
        point.x <= rect.x + rect.width;
      if (inLabelBand) return true;
      const inflated = {
        x: rect.x - tolerance,
        y: rect.y - tolerance,
        width: rect.width + 2 * tolerance,
        height: rect.height + 2 * tolerance,
      };
      if (!rectContainsPoint(inflated, point)) return false;
      const deflated = {
        x: rect.x + tolerance,
        y: rect.y + tolerance,
        width: rect.width - 2 * tolerance,
        height: rect.height - 2 * tolerance,
      };
      const insideInterior =
        deflated.width > 0 && deflated.height > 0 && rectContainsPoint(deflated, point);
      return !insideInterior;
    }
    if (node.type === "ink") {
      const worldPoints = node.points.map((entry) => ({
        x: worldX + entry.x,
        y: worldY + entry.y,
      }));
      return strokeHitTest(worldPoints, point, tolerance + node.strokeWidth / 2);
    }
    const local = localRectOf(node, options.measuredSizes);
    return rectContainsPoint(
      {
        x: worldX + (local.x - node.x),
        y: worldY + (local.y - node.y),
        width: local.width,
        height: local.height,
      },
      point,
    );
  };

  const visit = (
    siblings: readonly CanvasNode[],
    offsetX: number,
    offsetY: number,
  ): CanvasNode | null => {
    for (let index = siblings.length - 1; index >= 0; index -= 1) {
      const node = siblings[index]!;
      const worldX = offsetX + node.x;
      const worldY = offsetY + node.y;
      const fromChildren = visit(childrenByParent.get(node.id) ?? [], worldX, worldY);
      if (fromChildren) return fromChildren;
      if (hitsNode(node, worldX, worldY)) return node;
    }
    return null;
  };

  return visit(childrenByParent.get(null) ?? [], 0, 0);
}

/**
 * Marquee selection: ids of nodes whose world rect intersects `rect`, in
 * document order. Frame children select individually (the child, not the
 * frame); frames themselves are only selected when fully contained.
 */
export function hitTestRect(
  doc: CanvasDocument,
  rect: CanvasRect,
  options: { measuredSizes?: CanvasMeasuredSizes } = {},
): string[] {
  const ids: string[] = [];
  for (const node of doc.nodes) {
    const world = worldRectOf(doc, node.id, options.measuredSizes);
    if (!world) continue;
    if (node.type === "frame") {
      if (rectContainsRect(rect, world)) ids.push(node.id);
    } else if (rectsIntersect(rect, world)) {
      ids.push(node.id);
    }
  }
  return ids;
}
