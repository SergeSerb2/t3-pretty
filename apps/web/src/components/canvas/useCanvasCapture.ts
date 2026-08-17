"use client";

/**
 * Capture flows behind the canvas: grab a preview browser tab or a desktop
 * window, place the bitmap as an image node, and re-capture an existing node
 * from the origin it recorded. Bridge access and store writes live here so the
 * menu, the empty-state CTAs, and the node context menu all share one path.
 */
import type {
  CanvasDocument,
  CanvasImageNode,
  CanvasImageSourceRef,
  DesktopCaptureSource,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback, useState } from "react";

import { contentBounds, getNode } from "~/canvasDocSync";
import { useCanvasStore } from "~/canvasStore";
import type { CanvasPoint } from "~/canvasViewport";
import { toastManager } from "~/components/ui/toast";
import { randomUUID } from "~/lib/utils";
import { useThreadPreviewState } from "~/previewStateStore";

import {
  buildCapturePlacement,
  buildRecaptureOps,
  canvasCaptureTabs,
  matchWindowCaptureSources,
  preferredCaptureTab,
  previewTabSourceRef,
  windowSourceRef,
  type CanvasCaptureImage,
  type CanvasCaptureTab,
} from "./canvasCapture";
import {
  CANVAS_CAPTURE_MAX_DIMENSION,
  canvasCaptureBridge,
  canvasCaptureSupported,
  canvasTabImageCapture,
} from "./captureBridge";

/** What an open window picker should do with the source the user clicks. */
export type CanvasWindowPickerRequest =
  | { readonly mode: "place" }
  | { readonly mode: "recapture"; readonly node: CanvasImageNode; readonly label: string };

const captureFailed = (title: string, error: unknown): void => {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "An error occurred.",
  });
};

export interface CanvasCaptureApi {
  /** True when this build can capture anything at all (desktop only). */
  readonly supported: boolean;
  /** Open preview browser tabs for the thread, in tab-strip order. */
  readonly tabs: readonly CanvasCaptureTab[];
  readonly canCaptureTabs: boolean;
  readonly canCaptureWindows: boolean;
  readonly captureTab: (tab: CanvasCaptureTab) => Promise<void>;
  /** Capture the active tab (or the most recent one); no-op without tabs. */
  readonly capturePreferredTab: () => Promise<void>;
  readonly captureWindowSource: (source: DesktopCaptureSource) => Promise<void>;
  readonly placeImage: (input: {
    image: CanvasCaptureImage;
    name: string;
    sourceRef?: CanvasImageSourceRef;
  }) => void;
  readonly recaptureNode: (nodeId: string) => Promise<void>;
  readonly isRecapturable: (nodeId: string) => boolean;
  readonly pickerRequest: CanvasWindowPickerRequest | null;
  readonly openWindowPicker: () => void;
  readonly closeWindowPicker: () => void;
  /** Resolve the source a picker click selected against the pending request. */
  readonly resolvePickedSource: (source: DesktopCaptureSource) => Promise<void>;
}

export function useCanvasCapture(input: {
  threadRef: ScopedThreadRef;
  doc: CanvasDocument;
  /** World point a fresh capture should be centered on. */
  worldCenter: () => CanvasPoint | null;
  /**
   * Selects the captured node. Prefer the viewport's setter: it also reports
   * the selection to the server, which is what `canvas_get_state` shows the
   * agent, and what survives the next snapshot.
   */
  selectNodes?: ((ids: readonly string[]) => void) | undefined;
}): CanvasCaptureApi {
  const { threadRef, doc } = input;
  const previewState = useThreadPreviewState(threadRef);
  const [pickerRequest, setPickerRequest] = useState<CanvasWindowPickerRequest | null>(null);

  const tabs = canvasCaptureTabs(threadRef, {
    sessions: previewState.sessions,
    serverEpoch: previewState.serverEpoch,
    activeTabId: previewState.activeTabId,
  });

  const selectNodesProp = input.selectNodes;
  const selectNodes = useCallback(
    (ids: readonly string[]) => {
      if (selectNodesProp !== undefined) selectNodesProp(ids);
      else useCanvasStore.getState().setSelection(threadRef, ids);
    },
    [selectNodesProp, threadRef],
  );

  const placeImage = useCallback(
    (capture: { image: CanvasCaptureImage; name: string; sourceRef?: CanvasImageSourceRef }) => {
      const store = useCanvasStore.getState();
      const center =
        input.worldCenter() ??
        (() => {
          const bounds = contentBounds(doc);
          return bounds === null
            ? { x: 0, y: 0 }
            : { x: bounds.x + bounds.width + 48, y: bounds.y + bounds.height / 2 };
        })();
      const { nodeId, op } = buildCapturePlacement({
        id: randomUUID(),
        image: capture.image,
        name: capture.name,
        ...(capture.sourceRef !== undefined ? { sourceRef: capture.sourceRef } : {}),
        center,
      });
      store.setLocalImagePreview(threadRef, nodeId, capture.image.dataUrl);
      store.commitLocalOps(threadRef, [op]);
      selectNodes([nodeId]);
    },
    [doc, input, selectNodes, threadRef],
  );

  const placeCapture = placeImage;

  const captureTab = useCallback(
    async (tab: CanvasCaptureTab) => {
      if (canvasTabImageCapture === null) return;
      try {
        const image = await canvasTabImageCapture(tab.runtimeTabId, CANVAS_CAPTURE_MAX_DIMENSION);
        placeCapture({ image, name: tab.title, sourceRef: previewTabSourceRef(tab) });
      } catch (error) {
        captureFailed("Could not capture the browser tab", error);
      }
    },
    [placeCapture],
  );

  const capturePreferredTab = useCallback(async () => {
    const tab = preferredCaptureTab(tabs);
    if (tab === null) return;
    await captureTab(tab);
  }, [captureTab, tabs]);

  const captureWindowSource = useCallback(
    async (source: DesktopCaptureSource) => {
      if (canvasCaptureBridge === null) return;
      try {
        const image = await canvasCaptureBridge.captureSource({
          sourceId: source.sourceId,
          maxDimension: CANVAS_CAPTURE_MAX_DIMENSION,
        });
        placeCapture({ image, name: source.name, sourceRef: windowSourceRef(source) });
      } catch (error) {
        captureFailed("Could not capture that window", error);
      }
    },
    [placeCapture],
  );

  const applyRecapture = useCallback(
    (node: CanvasImageNode, image: CanvasCaptureImage, sourceRef: CanvasImageNode["sourceRef"]) => {
      const store = useCanvasStore.getState();
      // The server rejects an add for an id it still holds, so the batch drops
      // the node and re-adds it in one apply: atomic, and one undo entry.
      store.setLocalImagePreview(threadRef, node.id, image.dataUrl);
      store.commitLocalOps(
        threadRef,
        buildRecaptureOps({ node, image, sourceRef: sourceRef ?? { kind: "agent" } }),
      );
      selectNodes([node.id]);
    },
    [selectNodes, threadRef],
  );

  const imageNode = useCallback(
    (nodeId: string): CanvasImageNode | null => {
      const node = getNode(doc, nodeId);
      return node !== null && node.type === "image" ? node : null;
    },
    [doc],
  );

  const recaptureNode = useCallback(
    async (nodeId: string) => {
      const node = imageNode(nodeId);
      const sourceRef = node?.sourceRef;
      if (node === null || sourceRef === undefined) return;

      if (sourceRef.kind === "preview-tab") {
        if (canvasTabImageCapture === null) return;
        const tab = tabs.find((entry) => entry.tabId === sourceRef.tabId);
        if (tab === undefined) {
          toastManager.add({
            type: "error",
            title: "That browser tab is no longer open",
            description: "Open the page in the browser panel, then capture it again.",
          });
          return;
        }
        try {
          const image = await canvasTabImageCapture(tab.runtimeTabId, CANVAS_CAPTURE_MAX_DIMENSION);
          applyRecapture(node, image, previewTabSourceRef(tab));
        } catch (error) {
          captureFailed("Could not re-capture the browser tab", error);
        }
        return;
      }

      if (sourceRef.kind !== "window" || canvasCaptureBridge === null) return;
      const bridge = canvasCaptureBridge;
      const label = sourceRef.windowTitle ?? node.name ?? "window";
      try {
        const image = await bridge.captureSource({
          sourceId: sourceRef.sourceId,
          maxDimension: CANVAS_CAPTURE_MAX_DIMENSION,
        });
        applyRecapture(node, image, sourceRef);
      } catch {
        // Electron window ids die with the window, so a miss is expected after
        // the target app restarts: re-match by title, and ask when unsure.
        let matches: DesktopCaptureSource[] = [];
        try {
          const sources = await bridge.listSources({ kinds: ["window"] });
          matches = matchWindowCaptureSources(sources, sourceRef);
        } catch (error) {
          captureFailed("Could not re-capture that window", error);
          return;
        }
        const only = matches.length === 1 ? matches[0] : undefined;
        if (only === undefined) {
          setPickerRequest({ mode: "recapture", node, label });
          return;
        }
        try {
          const image = await bridge.captureSource({
            sourceId: only.sourceId,
            maxDimension: CANVAS_CAPTURE_MAX_DIMENSION,
          });
          applyRecapture(node, image, windowSourceRef(only));
        } catch (error) {
          captureFailed("Could not re-capture that window", error);
        }
      }
    },
    [applyRecapture, imageNode, tabs],
  );

  const resolvePickedSource = useCallback(
    async (source: DesktopCaptureSource) => {
      const request = pickerRequest;
      setPickerRequest(null);
      if (request === null || request.mode === "place") {
        await captureWindowSource(source);
        return;
      }
      if (canvasCaptureBridge === null) return;
      // The node may have been removed while the picker was open.
      const current = imageNode(request.node.id);
      if (current === null) return;
      try {
        const image = await canvasCaptureBridge.captureSource({
          sourceId: source.sourceId,
          maxDimension: CANVAS_CAPTURE_MAX_DIMENSION,
        });
        applyRecapture(current, image, windowSourceRef(source));
      } catch (error) {
        captureFailed("Could not re-capture that window", error);
      }
    },
    [applyRecapture, captureWindowSource, imageNode, pickerRequest],
  );

  const isRecapturable = useCallback(
    (nodeId: string): boolean => {
      const node = imageNode(nodeId);
      const kind = node?.sourceRef?.kind;
      if (kind === "preview-tab") return canvasTabImageCapture !== null;
      if (kind === "window") return canvasCaptureBridge !== null;
      return false;
    },
    [imageNode],
  );

  return {
    supported: canvasCaptureSupported,
    tabs,
    canCaptureTabs: canvasTabImageCapture !== null && tabs.length > 0,
    canCaptureWindows: canvasCaptureBridge !== null,
    captureTab,
    capturePreferredTab,
    captureWindowSource,
    placeImage,
    recaptureNode,
    isRecapturable,
    pickerRequest,
    openWindowPicker: useCallback(() => setPickerRequest({ mode: "place" }), []),
    closeWindowPicker: useCallback(() => setPickerRequest(null), []),
    resolvePickedSource,
  };
}
