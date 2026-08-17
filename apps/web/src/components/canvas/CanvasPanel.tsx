"use client";

import type { ScopedThreadRef } from "@t3tools/contracts";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import { selectThreadCanvasState, useCanvasStore } from "~/canvasStore";
import { Spinner } from "~/components/ui/spinner";
import { useComposerDraftStore } from "~/composerDraftStore";
import { canvasFirstSendNodeIds } from "~/lib/canvasFirst";
import type { CanvasSelectionNodeSummary } from "~/lib/canvasSelection";
import { toastManager } from "~/components/ui/toast";
import { useServerConfigs } from "~/state/entities";

import { CanvasAddToChatBar } from "./CanvasAddToChatBar";
import { CanvasCaptureMenu } from "./CanvasCaptureMenu";
import { CanvasEmptyState } from "./CanvasEmptyState";
import {
  filesToCanvasCaptureImages,
  imageFilesFromClipboard,
  imageFilesFromDataTransfer,
  isTextEditingTarget,
} from "./canvasImageImport";
import {
  attachCanvasSelectionToDraft,
  canvasSelectionAttachmentResources,
  canvasSelectionImageSrcByNodeId,
  cropImageNodes,
} from "./canvasSelectionAttach";
import { readCanvasCropPalette } from "./canvasSelectionCrop";
import { CanvasToolbar, DEFAULT_CANVAS_INK_STYLE, type CanvasInkStyle } from "./CanvasToolbar";
import { CanvasViewport, type CanvasViewportController } from "./CanvasViewport";
import { CanvasWindowCaptureDialog } from "./CanvasWindowCaptureDialog";
import { useCanvasCapture } from "./useCanvasCapture";
import { useCanvasDoc } from "./useCanvasDoc";

function CanvasPanelLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    </div>
  );
}

export interface CanvasPanelHandle {
  prepareCanvasFirstSend: () => Promise<{
    ok: boolean;
    nodes: CanvasSelectionNodeSummary[];
  }>;
}

export interface CanvasPanelProps {
  threadRef: ScopedThreadRef;
  hideSelectionBar?: boolean;
  captureGlobalPaste?: boolean;
}

/**
 * Gates the canvas surface on the environment's server advertising the canvas
 * capability. A pre-canvas server answers `canvas.get` with an "unknown
 * request tag" defect, so probing it would surface a load error the user can
 * never retry away; the gate names the actual remedy instead. The capability
 * lives outside the inner component so no canvas RPC fires until it is known.
 */
export const CanvasPanel = forwardRef<CanvasPanelHandle, CanvasPanelProps>(function CanvasPanel(
  { threadRef, hideSelectionBar = false, captureGlobalPaste = false },
  ref,
) {
  const serverConfigs = useServerConfigs();
  const serverConfig = serverConfigs.get(threadRef.environmentId);
  if (serverConfig === undefined) {
    return <CanvasPanelLoading />;
  }
  if (serverConfig.environment.capabilities.canvas !== true) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-muted-foreground text-sm">
            This environment&apos;s server is too old for the canvas.
          </p>
          <p className="max-w-sm text-muted-foreground/70 text-xs">
            Update the server running this environment, then reopen the canvas.
          </p>
        </div>
      </div>
    );
  }
  return (
    <CanvasPanelContent
      ref={ref}
      threadRef={threadRef}
      hideSelectionBar={hideSelectionBar}
      captureGlobalPaste={captureGlobalPaste}
    />
  );
});

/**
 * Canvas right-panel surface: syncs the thread's canvas document and composes
 * the toolbar, the interactive viewport, the capture flows, and the empty-state
 * overlay. The empty state floats over a live viewport so the draw tools work
 * on an empty canvas the moment a tool is picked.
 */
const CanvasPanelContent = forwardRef<CanvasPanelHandle, CanvasPanelProps>(
  function CanvasPanelContent(
    { threadRef, hideSelectionBar = false, captureGlobalPaste = false },
    ref,
  ) {
    const { doc, revision, loading, error, refresh } = useCanvasDoc(threadRef);
    const [inkStyle, setInkStyle] = useState<CanvasInkStyle>(DEFAULT_CANVAS_INK_STYLE);
    const controllerRef = useRef<CanvasViewportController | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const selectedIds = useCanvasStore(
      (state) => selectThreadCanvasState(state.byThreadKey, threadRef).selectedNodeIds,
    );
    const tool = useCanvasStore(
      (state) => selectThreadCanvasState(state.byThreadKey, threadRef).tool,
    );
    const hasGesture = useCanvasStore(
      (state) => selectThreadCanvasState(state.byThreadKey, threadRef).gesture !== null,
    );

    const capture = useCanvasCapture({
      threadRef,
      doc,
      worldCenter: useCallback(() => controllerRef.current?.worldCenter() ?? null, []),
      selectNodes: useCallback((ids: readonly string[]) => {
        controllerRef.current?.selectNodes(ids);
      }, []),
    });

    const sendNodeIds = canvasFirstSendNodeIds(doc, selectedIds);
    const imageNodes = cropImageNodes(doc, sendNodeIds, controllerRef.current?.measuredSizes());
    const attachmentResources = canvasSelectionAttachmentResources(
      doc,
      sendNodeIds,
      controllerRef.current?.measuredSizes(),
    );
    const assetUrls = useAssetUrls(threadRef.environmentId, attachmentResources);

    useEffect(() => {
      const session = useComposerDraftStore.getState().getDraftSessionByRef(threadRef);
      if (!session) return;
      const hasCanvasContent = doc.nodes.length > 0;
      if (session.hasCanvasContent === hasCanvasContent) return;
      useComposerDraftStore.getState().setDraftThreadContext(threadRef, { hasCanvasContent });
    }, [doc.nodes.length, threadRef]);

    const placeDroppedImages = useCallback(
      async (files: readonly File[]) => {
        const { images, error: importError } = await filesToCanvasCaptureImages(files);
        if (importError) {
          toastManager.add({
            type: images.length > 0 ? "warning" : "error",
            title: images.length > 0 ? "Some images were skipped" : "Could not add images",
            description: importError,
          });
        }
        for (const entry of images) {
          capture.placeImage(entry);
        }
      },
      [capture.placeImage],
    );

    const onDragOverCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
      if (![...event.dataTransfer.types].includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }, []);

    const onDropCapture = useCallback(
      (event: React.DragEvent<HTMLDivElement>) => {
        const files = imageFilesFromDataTransfer(event.dataTransfer);
        if (files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        void placeDroppedImages(files);
      },
      [placeDroppedImages],
    );

    useEffect(() => {
      const onPaste = (event: ClipboardEvent) => {
        if (isTextEditingTarget(event.target)) return;
        if (!captureGlobalPaste && !rootRef.current?.contains(event.target as Node | null)) {
          return;
        }
        const files = imageFilesFromClipboard(event);
        if (files.length === 0) return;
        event.preventDefault();
        void placeDroppedImages(files);
      };
      window.addEventListener("paste", onPaste);
      return () => window.removeEventListener("paste", onPaste);
    }, [captureGlobalPaste, placeDroppedImages]);

    const prepareCanvasFirstSend = useCallback(async () => {
      const nodeIds = canvasFirstSendNodeIds(doc, selectedIds);
      if (nodeIds.length === 0) {
        return { ok: false, nodes: [] };
      }
      const store = useComposerDraftStore.getState();
      const existing = store.getComposerDraft(threadRef);
      for (const selection of existing?.canvasSelections ?? []) {
        store.removeImage(threadRef, selection.id);
      }
      store.setCanvasSelections(threadRef, []);
      const measuredSizes = controllerRef.current?.measuredSizes();
      const urlByAttachmentId = new Map(
        attachmentResources.flatMap((resource, index) => {
          const url = assetUrls[index];
          return url ? [[resource.attachmentId, url] as const] : [];
        }),
      );
      const srcByNodeId = canvasSelectionImageSrcByNodeId(threadRef, imageNodes, urlByAttachmentId);
      const attached = await attachCanvasSelectionToDraft({
        threadRef,
        doc,
        revision,
        selectedIds: nodeIds,
        measuredSizes,
        resolveImageSrc: (node) => srcByNodeId.get(node.id) ?? null,
        palette: readCanvasCropPalette(rootRef.current),
      });
      if (attached === null) {
        return { ok: false, nodes: [] };
      }
      return { ok: true, nodes: attached.nodes };
    }, [assetUrls, attachmentResources, doc, imageNodes, revision, selectedIds, threadRef]);

    useImperativeHandle(ref, () => ({ prepareCanvasFirstSend }), [prepareCanvasFirstSend]);

    const renderSelectionBar = useCallback(
      ({ selectedIds: barSelectedIds }: { selectedIds: readonly string[] }) =>
        hideSelectionBar ? null : (
          <CanvasAddToChatBar
            threadRef={threadRef}
            doc={doc}
            revision={revision}
            selectedIds={barSelectedIds}
            measuredSizes={controllerRef.current?.measuredSizes()}
            paletteRef={rootRef}
          />
        ),
      [doc, hideSelectionBar, revision, threadRef],
    );

    if (loading) {
      return <CanvasPanelLoading />;
    }

    if (error !== null && doc.nodes.length === 0) {
      return (
        <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-muted-foreground text-sm">The canvas could not be loaded.</p>
            <p className="max-w-sm text-muted-foreground/70 text-xs">{error}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-1 cursor-pointer rounded-md border border-border/80 px-2.5 py-1 font-medium text-foreground text-xs transition hover:bg-accent/60"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    const showEmptyOverlay = doc.nodes.length === 0 && !hasGesture && tool === "select";

    return (
      <div
        ref={rootRef}
        className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background"
        onDragOverCapture={onDragOverCapture}
        onDropCapture={onDropCapture}
      >
        <CanvasViewport
          threadRef={threadRef}
          doc={doc}
          inkStyle={inkStyle}
          controllerRef={controllerRef}
          onRecaptureNode={capture.supported ? (id) => void capture.recaptureNode(id) : undefined}
          canRecaptureNode={capture.supported ? capture.isRecapturable : undefined}
          renderSelectionBar={hideSelectionBar ? undefined : renderSelectionBar}
        />
        <CanvasToolbar
          threadRef={threadRef}
          inkStyle={inkStyle}
          onInkStyleChange={setInkStyle}
          onZoomIn={() => controllerRef.current?.zoomIn()}
          onZoomOut={() => controllerRef.current?.zoomOut()}
          onZoomToFit={() => controllerRef.current?.zoomToFit()}
          onZoomTo={(scale) => controllerRef.current?.zoomTo(scale)}
          captureSlot={<CanvasCaptureMenu capture={capture} />}
        />
        {showEmptyOverlay ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex">
            <CanvasEmptyState
              onCaptureTab={
                capture.canCaptureTabs ? () => void capture.capturePreferredTab() : undefined
              }
              onCaptureWindow={capture.canCaptureWindows ? capture.openWindowPicker : undefined}
            />
          </div>
        ) : null}
        <CanvasWindowCaptureDialog
          request={capture.pickerRequest}
          onClose={capture.closeWindowPicker}
          onPick={(source) => void capture.resolvePickedSource(source)}
        />
      </div>
    );
  },
);
