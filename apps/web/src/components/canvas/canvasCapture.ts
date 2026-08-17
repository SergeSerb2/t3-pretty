/**
 * Pure helpers behind the canvas capture flows.
 *
 * Everything here is plain data in / plain data out: tab enumeration, capture
 * placement geometry, the op batches a capture (or re-capture) commits, and
 * window re-matching after Electron source ids go stale. No React, store, DOM,
 * or bridge access, so the whole capture pipeline stays unit-testable.
 */
import type {
  CanvasImageInit,
  CanvasImageNode,
  CanvasImageSourceRef,
  CanvasOp,
  DesktopCaptureSource,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";

import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import type { CanvasRect } from "~/canvasDocSync";
import { screenToWorld, type CanvasPoint, type CanvasViewportTransform } from "~/canvasViewport";

/** Longest side, in world units, a freshly placed capture is scaled to fit. */
export const CANVAS_CAPTURE_PLACED_MAX_SIZE = 640;

/** Gap left between existing content and a capture placed at the content edge. */
const CONTENT_EDGE_GAP = 48;

/** Raw bitmap handed back by either capture bridge. */
export interface CanvasCaptureImage {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

/** One preview browser tab offered by the capture menu. */
export interface CanvasCaptureTab {
  /** Server-side tab id; stable across app restarts, stored in `sourceRef`. */
  readonly tabId: string;
  /** Desktop-side id the preview bridge is keyed by; derived, never stored. */
  readonly runtimeTabId: string;
  readonly title: string;
  readonly url: string | null;
  readonly active: boolean;
}

/** The slice of `ThreadPreviewState` tab enumeration needs. */
export interface CanvasCaptureTabsInput {
  readonly sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  readonly serverEpoch: string | null;
  readonly activeTabId: string | null;
}

function previewTabTitle(snapshot: PreviewSessionSnapshot): string {
  if (snapshot.navStatus._tag === "Idle") return "Browser";
  const title = snapshot.navStatus.title.trim();
  if (title.length > 0) return title;
  try {
    return new URL(snapshot.navStatus.url).host || "Browser";
  } catch {
    return "Browser";
  }
}

function previewTabUrl(snapshot: PreviewSessionSnapshot): string | null {
  return snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
}

/**
 * Open preview tabs for a thread, newest-updated last (the order the tab strip
 * uses), with the desktop runtime id resolved for each. Titles and favicon
 * origins follow the same rules as the right-panel tab strip.
 */
export function canvasCaptureTabs(
  threadRef: ScopedThreadRef,
  state: CanvasCaptureTabsInput,
): CanvasCaptureTab[] {
  return Object.values(state.sessions)
    .toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map((snapshot) => ({
      tabId: snapshot.tabId,
      runtimeTabId: previewRuntimeTabId(threadRef, state.serverEpoch, snapshot.tabId),
      title: previewTabTitle(snapshot),
      url: previewTabUrl(snapshot),
      active: snapshot.tabId === state.activeTabId,
    }));
}

/** The tab an untargeted "capture browser tab" action should grab. */
export function preferredCaptureTab(tabs: readonly CanvasCaptureTab[]): CanvasCaptureTab | null {
  return tabs.find((tab) => tab.active) ?? tabs.at(-1) ?? null;
}

/**
 * Placed size for a capture: the bitmap scaled down so its longest side is at
 * most `maxSize` world units. Never upscales, so a tiny capture stays tiny.
 */
export function fitCaptureWorldSize(
  image: { width: number; height: number },
  maxSize = CANVAS_CAPTURE_PLACED_MAX_SIZE,
): { width: number; height: number } {
  const width = Number.isFinite(image.width) && image.width > 0 ? image.width : maxSize;
  const height = Number.isFinite(image.height) && image.height > 0 ? image.height : maxSize;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  return { width: width * scale, height: height * scale };
}

/**
 * Where a capture should land: the world point under the viewport's center
 * when the viewport has been measured, otherwise just past the right edge of
 * existing content (and the origin for an empty canvas).
 */
export function captureWorldCenter(
  viewport: CanvasViewportTransform,
  viewportSize: { width: number; height: number } | null,
  contentBounds: CanvasRect | null,
): CanvasPoint {
  if (viewportSize !== null && viewportSize.width > 0 && viewportSize.height > 0) {
    return screenToWorld(viewport, {
      x: viewportSize.width / 2,
      y: viewportSize.height / 2,
    });
  }
  if (contentBounds !== null) {
    return {
      x: contentBounds.x + contentBounds.width + CONTENT_EDGE_GAP,
      y: contentBounds.y + contentBounds.height / 2,
    };
  }
  return { x: 0, y: 0 };
}

const positiveInt = (value: number): number | undefined =>
  Number.isInteger(value) && value > 0 ? value : undefined;

function imageInit(input: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image: CanvasCaptureImage;
  name?: string | undefined;
  parentId?: string | undefined;
  sourceRef?: CanvasImageSourceRef | undefined;
}): CanvasImageInit {
  const naturalWidth = positiveInt(input.image.width);
  const naturalHeight = positiveInt(input.image.height);
  const name = input.name?.trim();
  return {
    id: input.id,
    type: "image",
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    ...(name ? { name: name.slice(0, 200) } : {}),
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    ...(naturalWidth !== undefined ? { naturalWidth } : {}),
    ...(naturalHeight !== undefined ? { naturalHeight } : {}),
    ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
  };
}

/**
 * The single `add-image` op that drops a capture on the canvas centered at
 * `center`, plus the node id the caller should preview and select.
 */
export function buildCapturePlacement(input: {
  id: string;
  image: CanvasCaptureImage;
  name: string;
  sourceRef?: CanvasImageSourceRef | undefined;
  center: CanvasPoint;
  maxSize?: number;
}): { nodeId: string; op: CanvasOp } {
  const size = fitCaptureWorldSize(input.image, input.maxSize);
  return {
    nodeId: input.id,
    op: {
      _tag: "add-image",
      node: imageInit({
        id: input.id,
        x: input.center.x - size.width / 2,
        y: input.center.y - size.height / 2,
        width: size.width,
        height: size.height,
        image: input.image,
        name: input.name,
        sourceRef: input.sourceRef,
      }),
      image: { kind: "dataUrl", dataUrl: input.image.dataUrl },
    },
  };
}

/**
 * Ops that replace an image node's bitmap in place. The server rejects an
 * `add-image` for an id it already holds, so a re-capture removes and re-adds
 * inside one batch: applied atomically, undone as a single entry, and the
 * placed width is preserved while the height follows the new aspect ratio.
 */
export function buildRecaptureOps(input: {
  node: CanvasImageNode;
  image: CanvasCaptureImage;
  sourceRef: CanvasImageSourceRef;
}): CanvasOp[] {
  const { node, image } = input;
  const aspect =
    Number.isFinite(image.width) && Number.isFinite(image.height) && image.width > 0
      ? image.height / image.width
      : node.height / Math.max(node.width, 1);
  const width = node.width > 0 ? node.width : fitCaptureWorldSize(image).width;
  return [
    { _tag: "remove", id: node.id },
    {
      _tag: "add-image",
      node: imageInit({
        id: node.id,
        x: node.x,
        y: node.y,
        width,
        height: Math.max(1, width * aspect),
        image,
        name: node.name,
        parentId: node.parentId,
        sourceRef: input.sourceRef,
      }),
      image: { kind: "dataUrl", dataUrl: image.dataUrl },
    },
  ];
}

/** Image nodes carrying a re-capturable origin (agent-placed images are not). */
export function isRecapturableImageNode(
  node: { type: string; sourceRef?: CanvasImageSourceRef | undefined } | null | undefined,
): boolean {
  if (!node || node.type !== "image" || node.sourceRef === undefined) return false;
  return node.sourceRef.kind === "preview-tab" || node.sourceRef.kind === "window";
}

const normalizeTitle = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

/**
 * Re-resolve a stored window source after its Electron id went stale (ids are
 * per-process). Matches on window title, additionally requiring the app name
 * when the capture recorded one. Callers treat a single match as unambiguous
 * and fall back to the picker for zero or several.
 */
export function matchWindowCaptureSources(
  sources: readonly DesktopCaptureSource[],
  sourceRef: Extract<CanvasImageSourceRef, { kind: "window" }>,
): DesktopCaptureSource[] {
  const windowTitle = normalizeTitle(sourceRef.windowTitle);
  const appName = normalizeTitle(sourceRef.appName);
  if (windowTitle.length === 0 && appName.length === 0) return [];
  return sources.filter((source) => {
    if (windowTitle.length > 0 && normalizeTitle(source.name) !== windowTitle) return false;
    if (appName.length > 0 && normalizeTitle(source.appName) !== appName) return false;
    return true;
  });
}

/** Picker sections: windows first (the common case), then whole screens. */
export function groupCaptureSources(sources: readonly DesktopCaptureSource[]): {
  windows: DesktopCaptureSource[];
  screens: DesktopCaptureSource[];
} {
  return {
    windows: sources.filter((source) => source.kind === "window"),
    screens: sources.filter((source) => source.kind === "screen"),
  };
}

/** `sourceRef` for a capture taken from a preview browser tab. */
export function previewTabSourceRef(tab: {
  tabId: string;
  url: string | null;
}): CanvasImageSourceRef {
  return {
    kind: "preview-tab",
    tabId: tab.tabId,
    ...(tab.url !== null && tab.url.length > 0 ? { url: tab.url } : {}),
  };
}

/** `sourceRef` for a capture taken from a desktop window or screen. */
export function windowSourceRef(source: {
  sourceId: string;
  name: string;
  appName: string | null;
}): CanvasImageSourceRef {
  const appName = source.appName?.trim();
  const windowTitle = source.name.trim();
  return {
    kind: "window",
    sourceId: source.sourceId,
    ...(appName ? { appName } : {}),
    ...(windowTitle ? { windowTitle } : {}),
  };
}
