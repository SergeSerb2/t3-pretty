"use client";

import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useRef, useState } from "react";

import { selectThreadCanvasState, useCanvasStore } from "~/canvasStore";
import { Spinner } from "~/components/ui/spinner";

import { CanvasAddToChatBar } from "./CanvasAddToChatBar";
import { CanvasCaptureMenu } from "./CanvasCaptureMenu";
import { CanvasEmptyState } from "./CanvasEmptyState";
import { CanvasToolbar, DEFAULT_CANVAS_INK_STYLE, type CanvasInkStyle } from "./CanvasToolbar";
import { CanvasViewport, type CanvasViewportController } from "./CanvasViewport";
import { CanvasWindowCaptureDialog } from "./CanvasWindowCaptureDialog";
import { useCanvasCapture } from "./useCanvasCapture";
import { useCanvasDoc } from "./useCanvasDoc";

/**
 * Canvas right-panel surface: syncs the thread's canvas document and composes
 * the toolbar, the interactive viewport, the capture flows, and the empty-state
 * overlay. The empty state floats over a live viewport so the draw tools work
 * on an empty canvas the moment a tool is picked.
 */
export function CanvasPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const { doc, revision, loading, error, refresh } = useCanvasDoc(threadRef);
  const [inkStyle, setInkStyle] = useState<CanvasInkStyle>(DEFAULT_CANVAS_INK_STYLE);
  const controllerRef = useRef<CanvasViewportController | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
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

  const renderSelectionBar = useCallback(
    ({ selectedIds }: { selectedIds: readonly string[] }) => (
      <CanvasAddToChatBar
        threadRef={threadRef}
        doc={doc}
        revision={revision}
        selectedIds={selectedIds}
        measuredSizes={controllerRef.current?.measuredSizes()}
        paletteRef={rootRef}
      />
    ),
    [doc, revision, threadRef],
  );

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      </div>
    );
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
    >
      <CanvasViewport
        threadRef={threadRef}
        doc={doc}
        inkStyle={inkStyle}
        controllerRef={controllerRef}
        onRecaptureNode={capture.supported ? (id) => void capture.recaptureNode(id) : undefined}
        canRecaptureNode={capture.supported ? capture.isRecapturable : undefined}
        renderSelectionBar={renderSelectionBar}
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
}
