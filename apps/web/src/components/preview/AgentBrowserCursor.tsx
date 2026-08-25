"use client";

import type { DesktopPreviewPointerEvent } from "@t3tools/contracts";
import { MousePointer2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useBrowserPointerStore } from "~/browser/browserPointerStore";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";

import {
  agentBrowserCursorOpacity,
  agentCursorActionLabel,
  agentCursorTransitionMs,
  type BrowserController,
} from "./agentBrowserCursorLogic";

const CURSOR_ACTIVE_MS = 700;

export function AgentBrowserCursor(props: {
  readonly tabId: string;
  readonly zoomFactor: number;
  readonly controller: BrowserController;
  readonly content?: {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly scrollLeft: number;
    readonly scrollTop: number;
  } | null;
}) {
  const { tabId, zoomFactor, controller } = props;
  const event = useBrowserPointerStore((state) => state.byTabId[tabId] ?? null);
  const storeContent = useBrowserSurfaceStore((state) => state.byTabId[tabId]?.content ?? null);
  const content = props.content ?? storeContent;

  if (!event) return null;

  return (
    <AgentBrowserCursorGlide
      key={tabId}
      event={event}
      content={content}
      zoomFactor={zoomFactor}
      controller={controller}
    />
  );
}

function AgentBrowserCursorGlide(props: {
  readonly event: DesktopPreviewPointerEvent;
  readonly content: {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly scrollLeft: number;
    readonly scrollTop: number;
  } | null;
  readonly zoomFactor: number;
  readonly controller: BrowserController;
}) {
  const { event, content, zoomFactor, controller } = props;
  const [active, setActive] = useState(true);

  useEffect(() => {
    setActive(true);
    const timeout = window.setTimeout(() => setActive(false), CURSOR_ACTIVE_MS);
    return () => window.clearTimeout(timeout);
  }, [event.sequence]);

  const scale = content?.scale ?? 1;
  const x = event.x * zoomFactor * scale + (content?.x ?? 0) - (content?.scrollLeft ?? 0);
  const y = event.y * zoomFactor * scale + (content?.y ?? 0) - (content?.scrollTop ?? 0);

  // Persist duration on the sequence that started the glide so later paints
  // of the same event (store, overlay, zoom, StrictMode) do not drop to 0ms
  // and cancel the compositor transition.
  const glideRef = useRef<{
    sequence: number;
    x: number;
    y: number;
    durationMs: number;
  } | null>(null);
  const durationMs = agentCursorTransitionMs({
    last: glideRef.current,
    sequence: event.sequence,
    x,
    y,
  });
  glideRef.current = { sequence: event.sequence, x, y, durationMs };

  const label = active ? agentCursorActionLabel(event.phase) : null;

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-40 transition-[transform,opacity] ease-out motion-reduce:transition-none"
      style={{
        opacity: agentBrowserCursorOpacity(active, controller),
        transform: `translate3d(${x}px, ${y}px, 0)`,
        transitionDuration: `${durationMs}ms, 150ms`,
      }}
      aria-hidden="true"
      data-agent-browser-cursor
    >
      {event.phase === "click" ? (
        <span
          key={event.sequence}
          className="absolute left-0.5 top-0.5 size-4 animate-agent-ripple rounded-full bg-primary/40 motion-reduce:hidden"
        />
      ) : null}
      <MousePointer2
        className="relative size-5 -translate-x-0.5 -translate-y-0.5 fill-background text-primary drop-shadow-sm"
        strokeWidth={2}
      />
      {label ? (
        <span className="absolute left-4 top-4 whitespace-nowrap rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary-foreground shadow-sm">
          {label}
        </span>
      ) : null}
    </div>
  );
}
