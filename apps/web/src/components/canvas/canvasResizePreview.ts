/**
 * Shared resize-gesture math for the canvas surface: node renderers and the
 * selection overlay both derive the live preview rect from the store gesture,
 * so the outline and the node body can never disagree mid-drag.
 */
import type { CanvasNode } from "@t3tools/contracts";

import type { CanvasRect } from "~/canvasDocSync";
import type { CanvasGesture } from "~/canvasStore";
import { resizeRectFromHandle } from "~/canvasViewport";

export const CANVAS_NODE_MIN_SIZE = 16;
export const CANVAS_NOTE_MIN_WIDTH = 100;

export type CanvasResizeGesture = Extract<CanvasGesture, { kind: "resize" }>;

/** World rect the resize gesture currently describes for `node`. */
export function resizeGesturePreviewRect(
  gesture: CanvasResizeGesture,
  node: CanvasNode,
): CanvasRect {
  const aspectRatio =
    gesture.aspectLocked && gesture.startRect.height > 0
      ? gesture.startRect.width / gesture.startRect.height
      : undefined;
  const rect = resizeRectFromHandle(gesture.startRect, gesture.handle, gesture.currentWorld, {
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    minWidth: node.type === "note" ? CANVAS_NOTE_MIN_WIDTH : CANVAS_NODE_MIN_SIZE,
    minHeight: CANVAS_NODE_MIN_SIZE,
  });
  // Notes size their height to their text; the gesture only drives width/x.
  if (node.type === "note") {
    return {
      x: rect.x,
      y: gesture.startRect.y,
      width: rect.width,
      height: gesture.startRect.height,
    };
  }
  return rect;
}
