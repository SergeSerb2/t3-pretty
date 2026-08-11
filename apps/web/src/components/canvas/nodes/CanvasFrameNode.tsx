"use client";

import type { CanvasFrameNode } from "@t3tools/contracts";
import type { ReactNode } from "react";

/**
 * Dashed frame with a screen-constant-ish name label above the top-left
 * corner. The label counter-scales through the `--canvas-label-scale` CSS
 * variable the world layer maintains, so zooming never repaints frames.
 * Children render inside a container at the frame origin (child coordinates
 * are parent-relative).
 */
export function CanvasFrameNodeView(props: {
  node: CanvasFrameNode;
  size: { width: number; height: number };
  children?: ReactNode;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 -translate-y-full pb-[3px]"
      >
        <div
          className="origin-bottom-left select-none whitespace-nowrap font-medium text-[11px] text-muted-foreground leading-none"
          style={{ transform: "scale(var(--canvas-label-scale, 1))" }}
        >
          {props.node.name ?? "Frame"}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 rounded-[2px] border border-foreground/25 border-dashed"
        style={{ width: props.size.width, height: props.size.height }}
      />
      <div className="absolute top-0 left-0">{props.children}</div>
    </>
  );
}
