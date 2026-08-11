"use client";

/**
 * Positions the selection action bar under the current selection in screen
 * space, clamped to stay inside the viewport. Rendering is delegated so the
 * viewport keeps no dependency on the composer.
 */
import type { CanvasDocument, ScopedThreadRef } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { unionRects, worldRectOf, type CanvasRect } from "~/canvasDocSync";
import { selectThreadCanvasState, useCanvasStore } from "~/canvasStore";
import { worldRectToScreen, type CanvasViewportTransform } from "~/canvasViewport";

import { useCanvasMeasuredSizes, type CanvasMeasuredSizesStore } from "./canvasMeasuredSizes";

const GAP = 10;
const EDGE_PADDING = 8;
/** Kept in sync with the bar's own min-width so clamping never cuts it off. */
const ESTIMATED_BAR_WIDTH = 320;

export function CanvasSelectionBarAnchor(props: {
  threadRef: ScopedThreadRef;
  doc: CanvasDocument;
  viewport: CanvasViewportTransform;
  measuredStore: CanvasMeasuredSizesStore;
  render: (input: { selectedIds: readonly string[] }) => ReactNode;
}) {
  const { doc, threadRef, viewport } = props;
  const selectedNodeIds = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).selectedNodeIds,
  );
  const gesture = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).gesture,
  );
  const measuredSizes = useCanvasMeasuredSizes(props.measuredStore);

  if (selectedNodeIds.length === 0 || gesture !== null) return null;

  let bounds: CanvasRect | null = null;
  for (const id of selectedNodeIds) {
    bounds = unionRects(bounds, worldRectOf(doc, id, measuredSizes));
  }
  if (bounds === null) return null;

  const screen = worldRectToScreen(viewport, bounds);
  const left = Math.max(EDGE_PADDING, screen.x + screen.width / 2 - ESTIMATED_BAR_WIDTH / 2);
  return (
    <div
      className="pointer-events-none absolute z-30 flex"
      style={{
        left,
        top: screen.y + screen.height + GAP,
        maxWidth: `calc(100% - ${EDGE_PADDING * 2}px)`,
      }}
    >
      {props.render({ selectedIds: selectedNodeIds })}
    </div>
  );
}
