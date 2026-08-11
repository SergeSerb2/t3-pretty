/**
 * Module-level handles to the desktop capture surfaces used by the canvas.
 *
 * Resolved once at import time (mirroring `preview/previewBridge.ts`) so
 * render paths never re-walk `window.desktopBridge`. Both handles are `null`
 * on the web build, and each is feature-detected independently: older desktop
 * builds ship the preview bridge without `capture` (screen/window grabs) or
 * without `preview.captureTabImage`.
 */
import type { DesktopCaptureBridge, DesktopPreviewTabImage } from "@t3tools/contracts";

const desktopBridge = typeof window === "undefined" ? null : (window.desktopBridge ?? null);

const captureBridge = desktopBridge?.capture ?? null;

/** Screen / window capture, or null when the host build predates it. */
export const canvasCaptureBridge: DesktopCaptureBridge | null =
  captureBridge !== null &&
  typeof captureBridge.captureSource === "function" &&
  typeof captureBridge.listSources === "function"
    ? captureBridge
    : null;

export type CanvasTabImageCapture = (
  runtimeTabId: string,
  maxDimension?: number,
) => Promise<DesktopPreviewTabImage>;

/** Preview-tab capture, bound to the bridge object so `this` stays intact. */
export const canvasTabImageCapture: CanvasTabImageCapture | null = (() => {
  const preview = desktopBridge?.preview ?? null;
  if (preview === null || typeof preview.captureTabImage !== "function") return null;
  return (runtimeTabId, maxDimension) => preview.captureTabImage(runtimeTabId, maxDimension);
})();

/** True when at least one capture path exists; gates the whole capture UI. */
export const canvasCaptureSupported =
  canvasCaptureBridge !== null || canvasTabImageCapture !== null;

/** Longest edge requested from every capture path, in device pixels. */
export const CANVAS_CAPTURE_MAX_DIMENSION = 2048;

/** Longest edge of the thumbnails rendered in the window/screen picker. */
export const CANVAS_CAPTURE_THUMBNAIL_MAX_DIMENSION = 320;
