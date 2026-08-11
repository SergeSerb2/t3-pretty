"use client";

import { AppWindow, Globe2 } from "lucide-react";
import type { ComponentType } from "react";

import { isElectron } from "~/env";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

const CAPTURE_DISABLED_REASON = "Coming online in this build";

/**
 * Capture CTA. Enabled only when a handler is wired in, so the capture
 * workstream turns these on by passing the props; until then they render
 * disabled with an explanatory tooltip.
 */
function CaptureButton(props: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick?: (() => void) | undefined;
}) {
  const Icon = props.icon;
  const content = (
    <>
      <Icon className="size-3.5" />
      {props.label}
    </>
  );
  if (props.onClick) {
    return (
      <button
        type="button"
        onClick={props.onClick}
        className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-border hover:bg-accent/60 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
      >
        {content}
      </button>
    );
  }
  const disabledButton = (
    <button
      type="button"
      aria-disabled="true"
      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-border/80 bg-card px-3 py-1.5 text-xs font-medium opacity-40 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
    >
      {content}
    </button>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={disabledButton} />
      <TooltipPopup side="top">{CAPTURE_DISABLED_REASON}</TooltipPopup>
    </Tooltip>
  );
}

export function CanvasEmptyState(props: {
  onCaptureTab?: (() => void) | undefined;
  onCaptureWindow?: (() => void) | undefined;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="pointer-events-auto w-full max-w-sm text-center">
        <h3 className="text-sm font-medium text-foreground">Canvas</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Capture a browser tab or app window, mark it up, and iterate with the agent.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <CaptureButton label="Capture browser tab" icon={Globe2} onClick={props.onCaptureTab} />
          <CaptureButton label="Capture window" icon={AppWindow} onClick={props.onCaptureWindow} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Or draw with the toolbar tools.</p>
        {!isElectron ? (
          <p className="mt-4 text-xs text-muted-foreground/70">
            Screen capture requires the T3 Pretty desktop app.
          </p>
        ) : null}
      </div>
    </div>
  );
}
