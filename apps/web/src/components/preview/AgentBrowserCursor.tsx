"use client";

import type { DesktopPreviewPointerEvent } from "@t3tools/contracts";
import { MousePointer2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useBrowserPointerStore } from "~/browser/browserPointerStore";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";

import {
  agentBrowserCursorOpacity,
  agentCursorActionLabel,
  agentCursorGlideMs,
  type BrowserController,
} from "./agentBrowserCursorLogic";

const CURSOR_ACTIVE_MS = 700;

export function AgentBrowserCursor(props: {
  readonly tabId: string;
  readonly zoomFactor: number;
  readonly controller: BrowserController;
}) {
  const { tabId, zoomFactor, controller } = props;
  const event = useBrowserPointerStore((state) => state.byTabId[tabId] ?? null);
  const content = useBrowserSurfaceStore((state) => state.byTabId[tabId]?.content ?? null);

  if (!event) return null;

  return (
    <AgentBrowserCursorGlide
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

  // Glide only when a new pointer event arrives; surface scroll/zoom between
  // events snaps instantly so the cursor stays glued to the page underneath.
  // The ref updates post-commit so re-renders (and StrictMode's double
  // render) of the same event keep the glide duration they started with.
  const glideRef = useRef<{ sequence: number; x: number; y: number } | null>(null);
  const last = glideRef.current;
  const durationMs =
    last !== null && last.sequence !== event.sequence
      ? agentCursorGlideMs(Math.hypot(x - last.x, y - last.y))
      : 0;
  useEffect(() => {
    glideRef.current = { sequence: event.sequence, x, y };
  }, [event.sequence, x, y]);

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
