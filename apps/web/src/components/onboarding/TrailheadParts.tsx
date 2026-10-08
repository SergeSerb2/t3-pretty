import { Check, Copy } from "lucide";
import type { CSSProperties, ReactNode } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { TRAILHEAD_WAYPOINTS, type TrailheadStep } from "../../onboarding/trailhead.logic";
import { MorphIcon } from "../MorphIcon";
import { Button } from "../ui/button";

/** Scrollable top of the field card. Re-keyed per waypoint so each one rises in. */
export function TrailheadCardBody({ children }: { readonly children: ReactNode }) {
  return (
    <div data-trailhead="card-body">
      <div data-trailhead="waypoint-content">{children}</div>
    </div>
  );
}

export function TrailheadCardFooter({ children }: { readonly children: ReactNode }) {
  return <div data-trailhead="card-footer">{children}</div>;
}

/** "02 —— Ridge", then the headline and a short lede. */
export function TrailheadHeading({
  step,
  title,
  children,
}: {
  readonly step: TrailheadStep;
  readonly title: ReactNode;
  readonly children?: ReactNode;
}) {
  const index = TRAILHEAD_WAYPOINTS.findIndex((waypoint) => waypoint.id === step);
  const waypoint = TRAILHEAD_WAYPOINTS[index]!;
  return (
    <header>
      <p data-trailhead="kicker">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <span>{waypoint.name}</span>
      </p>
      <h1 id="trailhead-title" data-trailhead="title">
        {title}
      </h1>
      {children ? <p data-trailhead="lede">{children}</p> : null}
    </header>
  );
}

export type TrailheadGlyphState = "pending" | "ready" | "attention";

/** One ruled line of the Base camp survey. */
export function TrailheadLedgerRow({
  label,
  state,
  order,
  children,
}: {
  readonly label: string;
  readonly state: TrailheadGlyphState;
  /** Stagger slot for the arrival animation. */
  readonly order: number;
  readonly children: ReactNode;
}) {
  return (
    <div
      data-trailhead="ledger-row"
      style={{ "--trailhead-row": order } as CSSProperties}
      role="group"
      aria-label={label}
    >
      <span data-trailhead="glyph" data-state={state} aria-hidden />
      <span data-trailhead="ledger-label">{label}</span>
      <div className="min-w-0" aria-live="polite">
        {children}
      </div>
    </div>
  );
}

export function TrailheadCommand({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    timeout: 1500,
    target: "command",
  });
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/40 px-3 py-2 font-mono text-sm",
        className,
      )}
    >
      <span className="min-w-0 truncate">
        <span className="mr-2 text-muted-foreground">$</span>
        {command}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Copy command"
        onClick={() => copyToClipboard(command, undefined)}
      >
        <MorphIcon className="size-3.5" icon={isCopied ? Check : Copy} />
      </Button>
    </div>
  );
}
