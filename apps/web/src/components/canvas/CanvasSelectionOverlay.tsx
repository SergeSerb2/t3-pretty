"use client";

/**
 * Screen-space overlay above the world layer: selection outlines, corner
 * resize handles, and the live marquee / ink / region gesture previews. All
 * geometry is computed with the pure viewport transforms so outlines stay
 * crisp at 1.5px regardless of zoom.
 */
import type { CanvasDocument, ScopedThreadRef } from "@t3tools/contracts";

import { getNode, worldRectOf, type CanvasRect } from "~/canvasDocSync";
import { selectThreadCanvasState, useCanvasStore, type CanvasGesture } from "~/canvasStore";
import {
  rectFromPoints,
  worldRectToScreen,
  worldToScreen,
  type CanvasResizeHandle,
  type CanvasViewportTransform,
} from "~/canvasViewport";

import { pathFromPoints } from "./canvasStroke";

import { resizeGesturePreviewRect } from "./canvasResizePreview";
import { useCanvasMeasuredSizes, type CanvasMeasuredSizesStore } from "./canvasMeasuredSizes";

const HANDLE_ORDER: readonly CanvasResizeHandle[] = ["nw", "ne", "sw", "se"];

const handleCursor = (handle: CanvasResizeHandle): string =>
  handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize";

const RESIZABLE_TYPES = new Set(["image", "region", "note", "frame"]);

/** True when `id` or any of its ancestors is in `movingIds`. */
function movesWith(doc: CanvasDocument, id: string, movingIds: ReadonlySet<string>): boolean {
  const seen = new Set<string>();
  let currentId: string | null = id;
  while (currentId !== null && !seen.has(currentId)) {
    if (movingIds.has(currentId)) return true;
    seen.add(currentId);
    currentId = getNode(doc, currentId)?.parentId ?? null;
  }
  return false;
}

export function CanvasSelectionOverlay(props: {
  threadRef: ScopedThreadRef;
  doc: CanvasDocument;
  viewport: CanvasViewportTransform;
  measuredStore: CanvasMeasuredSizesStore;
}) {
  const { threadRef, doc, viewport } = props;
  const selectedNodeIds = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).selectedNodeIds,
  );
  const gesture = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).gesture,
  );
  const measuredSizes = useCanvasMeasuredSizes(props.measuredStore);

  const movingIds = gesture !== null && gesture.kind === "move" ? new Set(gesture.nodeIds) : null;
  const moveDelta =
    gesture !== null && gesture.kind === "move"
      ? {
          x: gesture.currentWorld.x - gesture.startWorld.x,
          y: gesture.currentWorld.y - gesture.startWorld.y,
        }
      : null;

  const selection: { id: string; type: string; screen: CanvasRect }[] = [];
  for (const id of selectedNodeIds) {
    const node = getNode(doc, id);
    if (node === null) continue;
    let world: CanvasRect | null;
    if (gesture !== null && gesture.kind === "resize" && gesture.nodeId === id) {
      world = resizeGesturePreviewRect(gesture, node);
    } else {
      world = worldRectOf(doc, id, measuredSizes);
      if (
        world !== null &&
        movingIds !== null &&
        moveDelta !== null &&
        movesWith(doc, id, movingIds)
      ) {
        world = { ...world, x: world.x + moveDelta.x, y: world.y + moveDelta.y };
      }
    }
    if (world === null) continue;
    selection.push({ id, type: node.type, screen: worldRectToScreen(viewport, world) });
  }

  const showHandles =
    selection.length === 1 &&
    RESIZABLE_TYPES.has(selection[0]!.type) &&
    (gesture === null || gesture.kind === "resize");

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
      {selection.map((entry) => (
        <div
          key={entry.id}
          className="absolute rounded-[1px] border-[1.5px] border-primary"
          style={{
            left: entry.screen.x - 1,
            top: entry.screen.y - 1,
            width: entry.screen.width + 2,
            height: entry.screen.height + 2,
          }}
        />
      ))}
      {showHandles
        ? HANDLE_ORDER.map((handle) => {
            const rect = selection[0]!.screen;
            const x = handle === "nw" || handle === "sw" ? rect.x : rect.x + rect.width;
            const y = handle === "nw" || handle === "ne" ? rect.y : rect.y + rect.height;
            return (
              <div
                key={handle}
                data-canvas-handle={handle}
                data-node-id={selection[0]!.id}
                className="pointer-events-auto absolute size-2 rounded-[2px] border border-primary bg-card shadow-xs"
                style={{ left: x - 4, top: y - 4, cursor: handleCursor(handle) }}
              />
            );
          })
        : null}
      <GesturePreview gesture={gesture} viewport={viewport} />
    </div>
  );
}

function GesturePreview({
  gesture,
  viewport,
}: {
  gesture: CanvasGesture | null;
  viewport: CanvasViewportTransform;
}) {
  if (gesture === null) return null;
  if (gesture.kind === "ink") {
    const screenPoints = gesture.points.map((point) => worldToScreen(viewport, point));
    return (
      <svg className="absolute inset-0 size-full overflow-visible">
        <path
          d={pathFromPoints(screenPoints)}
          fill="none"
          stroke={gesture.color}
          strokeWidth={gesture.strokeWidth * viewport.scale}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (gesture.kind === "region") {
    const rect = worldRectToScreen(
      viewport,
      rectFromPoints(gesture.startWorld, gesture.currentWorld),
    );
    return (
      <svg className="absolute inset-0 size-full overflow-visible">
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={3}
          fill="var(--color-primary)"
          fillOpacity={0.06}
          stroke="var(--color-primary)"
          strokeWidth={Math.max(1.5, 2 * viewport.scale)}
        />
      </svg>
    );
  }
  if (gesture.kind === "marquee") {
    const rect = worldRectToScreen(
      viewport,
      rectFromPoints(gesture.startWorld, gesture.currentWorld),
    );
    return (
      <svg className="absolute inset-0 size-full overflow-visible">
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill="var(--color-primary)"
          fillOpacity={0.08}
          stroke="var(--color-primary)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      </svg>
    );
  }
  return null;
}
