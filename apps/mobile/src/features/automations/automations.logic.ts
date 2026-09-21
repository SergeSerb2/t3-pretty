import type { AutomationRunStatus, AutomationShell } from "@t3tools/contracts";
import type { AutomationRunRow, AutomationStatus } from "@t3tools/client-runtime/state/automations";
import { formatUntilLabel } from "@t3tools/client-runtime/state/automations";

import type { StatusTone } from "../../components/StatusPill";

const RUNNING_TONE = {
  pillClassName: "bg-adaptive-sky-500-a12-a16",
  textClassName: "text-adaptive-sky-700-300",
} as const;
const ATTENTION_TONE = {
  pillClassName: "bg-adaptive-amber-500-a12-a16",
  textClassName: "text-adaptive-amber-700-300",
} as const;
const FAILED_TONE = {
  pillClassName: "bg-adaptive-rose-500-a12-a16",
  textClassName: "text-adaptive-rose-700-300",
} as const;
const QUIET_TONE = {
  pillClassName: "bg-adaptive-zinc-500-a12-a16",
  textClassName: "text-foreground-muted",
} as const;
const DONE_TONE = {
  pillClassName: "bg-adaptive-emerald-500-a12-a16",
  textClassName: "text-adaptive-emerald-700-300",
} as const;

/**
 * Pill for an automation row. `null` for a healthy idle automation so the list
 * stays free of "Idle" noise, the way `resolveThreadStatus` treats quiet threads.
 */
export function automationStatusTone(status: AutomationStatus): StatusTone | null {
  switch (status) {
    case "running":
      return { label: "Running", ...RUNNING_TONE };
    case "needs-attention":
      return { label: "Needs you", ...ATTENTION_TONE };
    case "failed":
      return { label: "Failed", ...FAILED_TONE };
    case "paused":
      return { label: "Paused", ...QUIET_TONE };
    case "idle":
      return null;
  }
}

export function automationRunStatusTone(status: AutomationRunStatus): StatusTone {
  switch (status) {
    case "requested":
      return { label: "Queued", ...RUNNING_TONE };
    case "running":
      return { label: "Running", ...RUNNING_TONE };
    case "completed":
      return { label: "Completed", ...DONE_TONE };
    case "failed":
      return { label: "Failed", ...FAILED_TONE };
    case "interrupted":
      return { label: "Interrupted", ...ATTENTION_TONE };
    case "skipped":
      return { label: "Skipped", ...QUIET_TONE };
    case "missed":
      return { label: "Missed", ...QUIET_TONE };
  }
}

/**
 * Trailing countdown for a row, or `null` when there is nothing to count down
 * to. Paused automations say so through the status pill instead.
 */
export function automationNextRunLabel(
  shell: Pick<AutomationShell, "enabled" | "nextRunAt">,
  nowMs: number,
): string | null {
  if (!shell.enabled || shell.nextRunAt === null) {
    return null;
  }
  return formatUntilLabel(shell.nextRunAt, nowMs);
}

/** Label of a collapsed stretch of uneventful runs, e.g. "6 more runs · 2 skipped". */
export function collapsedRunsLabel(
  row: Pick<Extract<AutomationRunRow, { kind: "collapsed" }>, "count" | "skipped" | "missed">,
): string {
  const parts = [`${row.count} more ${row.count === 1 ? "run" : "runs"}`];
  if (row.skipped > 0) parts.push(`${row.skipped} skipped`);
  if (row.missed > 0) parts.push(`${row.missed} missed`);
  return parts.join(" · ");
}

/** Wall-clock length of a run, or `null` while it has not started. */
export function formatRunDuration(
  startedAt: string | null,
  finishedAt: string | null,
  nowMs: number,
): string | null {
  if (startedAt === null) return null;
  const started = Date.parse(startedAt);
  const ended = finishedAt === null ? nowMs : Date.parse(finishedAt);
  if (Number.isNaN(started) || Number.isNaN(ended)) return null;
  const seconds = Math.max(0, Math.round((ended - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// The server wraps every decider rejection in one sentence; the plain-language
// detail behind it is the only part worth showing on a row.
const INVARIANT_PREFIX = /^Orchestration command invariant failed \([^)]*\):\s*/u;

export function automationCommandErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message.length === 0 ? fallback : message.replace(INVARIANT_PREFIX, "");
}

/** Keeps the chosen environment while it exists, otherwise falls back to `preferred`. */
export function resolveAutomationEnvironmentId<Id>(
  selected: Id | null,
  preferred: Id | null,
  environments: ReadonlyArray<{ readonly environmentId: Id }>,
): Id | null {
  if (selected !== null && environments.some((entry) => entry.environmentId === selected)) {
    return selected;
  }
  return preferred;
}
