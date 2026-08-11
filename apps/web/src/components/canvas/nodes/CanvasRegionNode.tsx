"use client";

import type { CanvasRegionNode } from "@t3tools/contracts";

const DEFAULT_REGION_COLOR = "var(--color-primary)";

/**
 * Region callout: outlined rect with a faint tint and an optional label chip
 * floating above the top-left corner, both in the node's color.
 */
export function CanvasRegionNodeView(props: {
  node: CanvasRegionNode;
  size: { width: number; height: number };
}) {
  const { node, size } = props;
  const color = node.color !== undefined && node.color !== "" ? node.color : DEFAULT_REGION_COLOR;
  const width = Math.max(size.width, 1);
  const height = Math.max(size.height, 1);
  return (
    <>
      <svg
        aria-hidden="true"
        className="absolute top-0 left-0 overflow-visible"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          rx={3}
          fill={color}
          fillOpacity={0.06}
          stroke={color}
          strokeWidth={2}
        />
      </svg>
      {node.label !== undefined && node.label !== "" ? (
        <div className="pointer-events-none absolute top-0 left-0 -translate-y-full pb-[4px]">
          <div
            className="w-fit max-w-60 select-none truncate rounded-[3px] px-1.5 py-0.5 font-medium text-[10px] text-white leading-tight"
            style={{ backgroundColor: color }}
          >
            {node.label}
          </div>
        </div>
      ) : null}
    </>
  );
}
