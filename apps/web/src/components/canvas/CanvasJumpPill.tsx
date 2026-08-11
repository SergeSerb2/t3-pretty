"use client";

import { Sparkles, X } from "lucide-react";
import { useEffect } from "react";

import type { CanvasJumpPill } from "~/canvasStore";

const JUMP_PILL_TTL_MS = 8_000;

/**
 * Floating "the agent just added things" pill at the bottom of the canvas.
 * Jump animates the viewport to the added nodes' bounds; the pill dismisses
 * itself after 8s.
 */
export function CanvasJumpPillView(props: {
  pill: CanvasJumpPill;
  onJump: () => void;
  onDismiss: () => void;
}) {
  const { onDismiss } = props;
  const pillAt = props.pill.at;
  useEffect(() => {
    const timer = setTimeout(onDismiss, Math.max(0, pillAt + JUMP_PILL_TTL_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [pillAt, onDismiss]);

  return (
    <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
      <div className="flex items-center gap-1.5 rounded-full border border-border/80 bg-card/95 py-1 ps-3 pe-1 text-foreground text-xs shadow-lg/10 backdrop-blur-md dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/10">
        <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
        <span className="whitespace-nowrap">
          Agent added {props.pill.count === 1 ? "1 item" : `${props.pill.count} items`}
        </span>
        <button
          type="button"
          onClick={props.onJump}
          className="cursor-pointer rounded-full px-2 py-0.5 font-medium text-primary transition-colors hover:bg-primary/10"
        >
          Jump
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={props.onDismiss}
          className="cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}
