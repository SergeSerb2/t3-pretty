"use client";

import type { CanvasInkNode } from "@t3tools/contracts";

import { pathFromPoints, strokeBounds } from "../canvasStroke";

/**
 * Committed ink stroke: an svg sized to the padded stroke bounds with the
 * smoothed path in node-local coordinates. Strokes scale with the world (no
 * non-scaling-stroke); `currentColor` strokes inherit the theme foreground.
 */
export function CanvasInkNodeView({ node }: { node: CanvasInkNode }) {
  const bounds = strokeBounds(node.points, node.strokeWidth);
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  const path = pathFromPoints(
    node.points.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y })),
  );
  return (
    <svg
      aria-hidden="true"
      className="absolute overflow-visible"
      style={{ left: bounds.x, top: bounds.y }}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <path
        d={path}
        fill="none"
        stroke={node.color}
        strokeWidth={node.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
