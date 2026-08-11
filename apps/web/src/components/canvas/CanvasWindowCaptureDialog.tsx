"use client";

/**
 * Window / screen picker for canvas captures. Enumerates desktopCapturer
 * sources as a thumbnail grid, and surfaces the macOS Screen Recording
 * permission case explicitly: a denied grant returns empty bitmaps rather
 * than throwing, so without this explainer the picker would look merely empty.
 */
import type { DesktopCaptureSource } from "@t3tools/contracts";
import { MonitorSmartphone, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";

import { groupCaptureSources } from "./canvasCapture";
import { CANVAS_CAPTURE_THUMBNAIL_MAX_DIMENSION, canvasCaptureBridge } from "./captureBridge";
import type { CanvasWindowPickerRequest } from "./useCanvasCapture";

type PickerState =
  | { readonly status: "loading" }
  | { readonly status: "denied"; readonly permission: string }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly sources: readonly DesktopCaptureSource[] };

export function CanvasWindowCaptureDialog(props: {
  request: CanvasWindowPickerRequest | null;
  onClose: () => void;
  onPick: (source: DesktopCaptureSource) => void;
}) {
  const { request, onClose } = props;
  const open = request !== null;
  const [state, setState] = useState<PickerState>({ status: "loading" });

  const load = useCallback(async (): Promise<void> => {
    const bridge = canvasCaptureBridge;
    if (bridge === null) {
      setState({ status: "error", message: "This build cannot capture windows." });
      return;
    }
    setState({ status: "loading" });
    try {
      const permission = await bridge.getPermissionStatus();
      if (permission === "denied" || permission === "restricted") {
        setState({ status: "denied", permission });
        return;
      }
      const sources = await bridge.listSources({
        thumbnailMaxDimension: CANVAS_CAPTURE_THUMBNAIL_MAX_DIMENSION,
      });
      setState({ status: "ready", sources });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not list capture sources.",
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  const title =
    request !== null && request.mode === "recapture"
      ? `Re-capture ${request.label}`
      : "Capture a window or screen";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {request !== null && request.mode === "recapture"
              ? "Pick the window to refresh this image from."
              : "Pick a running app window or a whole screen to place on the canvas."}
          </DialogDescription>
        </DialogHeader>
        <PickerBody state={state} onPick={props.onPick} onRetry={() => void load()} />
      </DialogPopup>
    </Dialog>
  );
}

function PickerBody(props: {
  state: PickerState;
  onPick: (source: DesktopCaptureSource) => void;
  onRetry: () => void;
}) {
  const { state } = props;
  if (state.status === "loading") {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }
  if (state.status === "denied") {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
        <MonitorSmartphone aria-hidden="true" className="size-5 text-muted-foreground" />
        <p className="font-medium text-foreground text-sm">Screen Recording is turned off</p>
        <p className="max-w-md text-muted-foreground text-xs leading-relaxed">
          Allow T3 Pretty under System Settings → Privacy &amp; Security → Screen Recording, then
          relaunch the app. macOS only applies the change to a fresh launch.
        </p>
        <Button variant="outline" size="sm" className="mt-1" onClick={props.onRetry}>
          Check again
        </Button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-muted-foreground text-sm">{state.message}</p>
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  const { windows, screens } = groupCaptureSources(state.sources);
  if (windows.length === 0 && screens.length === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-muted-foreground text-sm">No capture sources are available.</p>
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="flex max-h-[60vh] min-h-0 flex-col gap-4 overflow-y-auto px-1 pb-1">
      <SourceSection title="Windows" sources={windows} onPick={props.onPick} />
      <SourceSection title="Screens" sources={screens} onPick={props.onPick} />
      <div className="flex justify-end">
        <Button variant="ghost" size="xs" onClick={props.onRetry} className="gap-1.5">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>
    </div>
  );
}

function SourceSection(props: {
  title: string;
  sources: readonly DesktopCaptureSource[];
  onPick: (source: DesktopCaptureSource) => void;
}) {
  if (props.sources.length === 0) return null;
  return (
    <section>
      <h4 className="mb-2 font-medium text-muted-foreground text-xs">{props.title}</h4>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {props.sources.map((source) => (
          <li key={source.sourceId}>
            <button
              type="button"
              onClick={() => props.onPick(source)}
              className="group flex w-full cursor-pointer flex-col gap-1.5 rounded-lg border border-border/80 bg-card p-1.5 text-left transition hover:border-border hover:bg-accent/60 dark:border-transparent dark:inset-ring-1 dark:inset-ring-white/5"
            >
              <span className="block aspect-video overflow-hidden rounded-md bg-muted">
                <img
                  src={source.thumbnailDataUrl}
                  alt=""
                  draggable={false}
                  className="size-full select-none object-contain"
                />
              </span>
              <span className="flex min-w-0 items-center gap-1.5 px-0.5 pb-0.5">
                {source.appIconDataUrl !== null ? (
                  <img
                    src={source.appIconDataUrl}
                    alt=""
                    draggable={false}
                    className="size-3.5 shrink-0 select-none"
                  />
                ) : null}
                <span className="truncate text-foreground text-xs">{source.name}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
