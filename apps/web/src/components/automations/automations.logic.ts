/**
 * Pure presentation logic for the web automation surfaces (sidebar shelf,
 * page, editor, banners). Grouping/condensing/status helpers live in
 * client-runtime so mobile shares them; this file only adds what is
 * web-specific: visual mapping, webhook URL composition, badge counting,
 * and the agent-setup prompt.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  automationNeedsAttention,
  type AutomationStatus,
  type EnvironmentAutomation,
} from "@t3tools/client-runtime/state/automations";
import type {
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationTrigger,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import {
  AUTOMATION_EVENT_LABELS,
  describeAutomationSchedule,
} from "@t3tools/shared/automationSchedule";
import type { StatusVisualKey } from "../ThreadStatusIndicators";

/** Row dot for an automation, from the shared run-status vocabulary. */
export function automationStatusVisual(status: AutomationStatus): StatusVisualKey {
  switch (status) {
    case "running":
      return "running";
    case "needs-attention":
      return "attention";
    case "failed":
      return "failed";
    case "paused":
      return "paused";
    case "idle":
      return "ready";
  }
}

export function automationRunStatusVisual(status: AutomationRunStatus): StatusVisualKey {
  switch (status) {
    case "requested":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "skipped":
      return "skipped";
    case "missed":
      return "missed";
  }
}

export type AutomationTriggerIcon = "clock" | "hand" | "zap" | "webhook" | "git";

export function automationTriggerIcon(
  type: AutomationTrigger["type"] | AutomationRunTrigger["type"],
): AutomationTriggerIcon {
  switch (type) {
    case "schedule":
      return "clock";
    case "manual":
      return "hand";
    case "event":
      return "zap";
    case "webhook":
      return "webhook";
    case "git":
      return "git";
  }
}

/** Chip text for a configured trigger (not a run's trigger — see automationRunTriggerLabel). */
export function describeAutomationTrigger(trigger: AutomationTrigger): string {
  switch (trigger.type) {
    case "schedule":
      return describeAutomationSchedule(trigger.cron, trigger.timezone);
    case "event":
      return AUTOMATION_EVENT_LABELS[trigger.event];
    case "webhook":
      return "Webhook";
    case "git":
      return trigger.branch === null ? "Push to default branch" : `Push to ${trigger.branch}`;
  }
}

export const WEBHOOK_LOOPBACK_NOTE =
  "Only reachable from this machine. Expose the server with Tailscale or T3 Connect and use that host instead.";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/** The server only knows its path; the URL is whatever this client dialed. */
export function composeWebhookUrl(
  httpBaseUrl: string | null,
  webhookPath: string | null,
): string | null {
  if (httpBaseUrl === null || webhookPath === null) {
    return null;
  }
  return `${httpBaseUrl.replace(/\/+$/u, "")}${webhookPath}`;
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

type RunThreadShell = Pick<OrchestrationThreadShell, "hasPendingApprovals" | "hasPendingUserInput">;

/**
 * Automations that add one to the inbox/dock badge. Run threads never reach
 * `countThreadsAwaitingUser` (they are filtered at the selector), so the
 * automation shell is the only source of truth for their attention state.
 * `runThreadByKey` holds every run thread the client knows; a failed run
 * whose thread is absent cannot be visited and so never badges.
 */
export function countAutomationsNeedingAttention(
  automations: ReadonlyArray<EnvironmentAutomation>,
  input: {
    readonly runThreadByKey: ReadonlyMap<string, RunThreadShell>;
    readonly lastVisitedAtByThreadKey: Readonly<Record<string, string>>;
  },
): number {
  let count = 0;
  for (const automation of automations) {
    const activeThreadId = automation.activeRun?.threadId ?? null;
    const activeThread =
      activeThreadId === null
        ? null
        : (input.runThreadByKey.get(
            scopedThreadKey(scopeThreadRef(automation.environmentId, activeThreadId)),
          ) ?? null);
    const lastThreadId = automation.lastRun?.threadId ?? null;
    const lastThreadKey =
      lastThreadId === null
        ? null
        : scopedThreadKey(scopeThreadRef(automation.environmentId, lastThreadId));
    const lastRunThread =
      lastThreadKey !== null && input.runThreadByKey.has(lastThreadKey)
        ? { lastVisitedAt: input.lastVisitedAtByThreadKey[lastThreadKey] ?? null }
        : null;
    if (automationNeedsAttention(automation, activeThread, lastRunThread)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Visible composer text for "New automation" / "Edit with agent". The MCP
 * toolkit is always attached, so the prompt only has to name it.
 */
export function automationSetupPrompt(
  automation: { readonly name: string; readonly id: string } | null = null,
): string {
  if (automation === null) {
    return "Help me set up an automation for this project using the t3-code-automations tools. Ask me what it should do and when it should run, validate the schedule, show me a summary before creating it, and don't run it unless I ask.";
  }
  return `Help me edit the automation "${automation.name}" (id ${automation.id}) using the t3-code-automations tools. Ask me what should change, validate any new schedule, show me a summary before updating it, and don't run it unless I ask.`;
}

/** Elapsed run time; null before the run started. Live runs pass `nowMs`. */
export function automationRunDurationMs(
  run: { readonly startedAt: string | null; readonly finishedAt: string | null },
  nowMs: number,
): number | null {
  if (run.startedAt === null) {
    return null;
  }
  const start = Date.parse(run.startedAt);
  const end = run.finishedAt === null ? nowMs : Date.parse(run.finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return Math.max(0, end - start);
}

/** "N more runs · k skipped · m missed" for a collapsed history row. */
export function collapsedRunRowLabel(row: {
  readonly count: number;
  readonly skipped: number;
  readonly missed: number;
}): string {
  const parts = [`${row.count} more runs`];
  if (row.skipped > 0) parts.push(`${row.skipped} skipped`);
  if (row.missed > 0) parts.push(`${row.missed} missed`);
  return parts.join(" · ");
}
