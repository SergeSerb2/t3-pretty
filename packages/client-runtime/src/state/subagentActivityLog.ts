/**
 * Session-scoped history for the Agents panel's per-agent sub-thread view.
 *
 * The native subagent fold (subagentRuntime.ts) is latest-state only by
 * design: ingestion upserts task.progress / tool.progress under stable
 * per-task activity ids, so a re-fold can never see more than the newest
 * tick per agent. Depth therefore has to be accumulated at observation time:
 * every time the fold output changes, `advanceSubagentActivityLog` diffs each
 * agent against what it recorded last and appends the new ticks — progress
 * summaries, tool heartbeats, status transitions, results — plus persisted
 * terminal tool actions attributed to that agent, to a bounded per-agent log.
 *
 * The log lives in client memory only (a ref beside the fold memo), keyed by
 * thread. History starts when the thread is first rendered in this session
 * and is dropped on thread switch; the persisted rows still provide the
 * latest tick + result for agents whose run predates the log.
 *
 * Purity contract: advancing with an unchanged roster returns the SAME log
 * reference (safe under React strict-mode double-invoke), and unchanged
 * agents keep their state object identity so memoized rows don't re-render.
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import type { RuntimeSubagent, RuntimeSubagentStatus } from "./subagentRuntime.ts";
import { isTerminalSubagentStatus } from "./subagentRuntime.ts";

export type SubagentLogEntryKind = "activity" | "tool" | "status" | "result" | "error";

export interface SubagentLogEntry {
  /** Stable identity used by incremental UI reconciliation. */
  readonly id: string;
  readonly at: string;
  readonly summary: string;
  readonly kind: SubagentLogEntryKind;
  /** Rich provider detail such as the command, query, or file target. */
  readonly detail?: string;
  readonly toolName?: string;
}

/** Per-agent log plus the dedup cursors the advance diff needs. */
export interface SubagentActivityLogState {
  readonly entries: ReadonlyArray<SubagentLogEntry>;
  /** Summaries of the agent's current recentActivity ring, in ring order.
   * Upserted rows slide their createdAt without changing content, so dedup
   * must ignore `at`. */
  readonly ringSummaries: ReadonlyArray<string>;
  readonly lastStatus: RuntimeSubagentStatus;
  readonly hasResult: boolean;
  readonly hasError: boolean;
  /** Terminal attributed tool rows already folded into `entries`. */
  readonly activityIds: ReadonlyArray<string>;
  /** Monotonic identity source for synthetic progress/status/result rows. */
  readonly nextSyntheticSequence: number;
}

export type SubagentActivityLog = ReadonlyMap<string, SubagentActivityLogState>;

const EMPTY_LOG: SubagentActivityLog = new Map();

export function emptySubagentActivityLog(): SubagentActivityLog {
  return EMPTY_LOG;
}

/** Per-agent cap. Old entries fall off the front; the feed is a tail view. */
const ENTRY_LIMIT = 100;

const EMPTY_ENTRIES: ReadonlyArray<SubagentLogEntry> = [];
const EMPTY_IDS: ReadonlyArray<string> = [];

interface AttributedToolEntry {
  readonly id: string;
  readonly entry: SubagentLogEntry;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function friendlyToolActivity(toolName: string): string {
  switch (toolName.trim().toLocaleLowerCase()) {
    case "bash":
    case "shell":
      return "Running a command";
    case "read":
      return "Reading files";
    case "grep":
    case "glob":
    case "search":
      return "Searching the codebase";
    case "edit":
    case "write":
    case "apply_patch":
      return "Editing files";
    case "webfetch":
    case "websearch":
      return "Researching on the web";
    default:
      return `Using ${toolName}`;
  }
}

export function subagentLogEntryFromActivity(
  id: string,
  at: string,
  summary: string,
): SubagentLogEntry {
  const match = /^▸\s*(.+)$/.exec(summary);
  if (!match?.[1]) {
    return { id, at, summary, kind: "activity" };
  }
  const toolName = match[1].trim();
  return {
    id,
    at,
    summary: friendlyToolActivity(toolName),
    kind: "tool",
    toolName,
  };
}

function stripToolPrefix(detail: string | undefined, toolName: string | undefined) {
  if (!detail || !toolName) {
    return detail;
  }
  const prefix = `${toolName}:`;
  if (!detail.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    return detail;
  }
  const stripped = detail.slice(prefix.length).trim();
  return stripped === "{}" ? undefined : stripped;
}

function completedToolSummary(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
  toolName: string | undefined,
): string {
  const itemType = stringValue(payload.itemType);
  if (toolName) {
    switch (toolName.toLocaleLowerCase()) {
      case "bash":
      case "shell":
        return "Ran command";
      case "read":
        return "Read file";
      case "grep":
      case "glob":
      case "search":
        return "Searched code";
      case "edit":
      case "write":
      case "apply_patch":
        return "Edited file";
      case "webfetch":
        return "Fetched page";
      case "websearch":
        return "Searched web";
      default:
        break;
    }
  }
  switch (itemType) {
    case "command_execution":
      return "Ran command";
    case "file_change":
      return "Changed files";
    case "web_search":
      return "Searched web";
    case "image_view":
      return "Viewed image";
    case "mcp_tool_call":
      return "Called integration";
    default:
      return activity.summary.replace(/\s+started$/i, "");
  }
}

/**
 * Terminal tool lifecycle rows already carry `agentId` and are intentionally
 * hidden from the parent work log. Re-home their useful command/query/target
 * detail into the owning agent's feed. Started/updated rows are omitted: the
 * provider's heartbeat covers live state, while the terminal row gives one
 * stable, non-duplicated action per tool use.
 */
function attributedToolEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyMap<string, ReadonlyArray<AttributedToolEntry>> {
  const byAgent = new Map<string, AttributedToolEntry[]>();
  for (const activity of activities) {
    if (activity.kind !== "tool.completed" && activity.kind !== "tool.denied") {
      continue;
    }
    const payload = recordValue(activity.payload);
    const agentId = stringValue(payload?.agentId);
    if (!payload || !agentId) {
      continue;
    }
    const data = recordValue(payload.data);
    const toolName = stringValue(data?.toolName) ?? stringValue(payload.toolName);
    const detail = stripToolPrefix(stringValue(payload.detail), toolName);
    const denied = activity.kind === "tool.denied";
    const entry: SubagentLogEntry = {
      id: activity.id,
      at: activity.createdAt,
      summary: denied
        ? toolName
          ? `${toolName} was denied`
          : "Tool was denied"
        : completedToolSummary(activity, payload, toolName),
      kind: denied ? "error" : "tool",
      ...(detail ? { detail } : {}),
      ...(toolName ? { toolName } : {}),
    };
    const list = byAgent.get(agentId) ?? [];
    list.push({ id: activity.id, entry });
    if (list.length > ENTRY_LIMIT) {
      list.splice(0, list.length - ENTRY_LIMIT);
    }
    byAgent.set(agentId, list);
  }
  return byAgent;
}

export function subagentLogEntries(
  log: SubagentActivityLog,
  agentId: string,
): ReadonlyArray<SubagentLogEntry> {
  return log.get(agentId)?.entries ?? EMPTY_ENTRIES;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) {
    return null;
  }
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return null;
  }
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Status-transition line, or null for transitions that are feed noise
 * (pending→running at spawn, waiting→running resumes). */
function statusEntrySummary(
  previous: RuntimeSubagentStatus,
  agent: RuntimeSubagent,
): string | null {
  const status = agent.status;
  if (status === previous) {
    return null;
  }
  const duration = formatDuration(agent.startedAt, agent.completedAt);
  switch (status) {
    case "completed":
      return duration ? `Completed in ${duration}` : "Completed";
    case "failed":
      return duration ? `Failed after ${duration}` : "Failed";
    case "cancelled":
    case "interrupted":
      return "Stopped";
    case "idle":
      return "Idle — resumable";
    case "waiting":
      return "Waiting";
    case "running":
    case "pending":
      // Reactivation of a settled identity is worth a line; the initial
      // spawn transition is not (the row header already reads Working).
      return isTerminalSubagentStatus(previous) || previous === "idle"
        ? `Reactivated · run ${agent.activationCount}`
        : null;
    default:
      return null;
  }
}

function appendBounded(entries: SubagentLogEntry[], entry: SubagentLogEntry): void {
  entries.push(entry);
  if (entries.length > ENTRY_LIMIT) {
    entries.splice(0, entries.length - ENTRY_LIMIT);
  }
}

function advanceAgent(
  previous: SubagentActivityLogState | undefined,
  agent: RuntimeSubagent,
  toolEntries: ReadonlyArray<AttributedToolEntry>,
): SubagentActivityLogState | null {
  const prevEntries = previous?.entries ?? EMPTY_ENTRIES;
  const prevRing = previous?.ringSummaries;
  const prevRingSet = prevRing === undefined ? undefined : new Set(prevRing);
  const prevStatus = previous?.lastStatus ?? "pending";
  const prevHasResult = previous?.hasResult ?? false;
  const prevHasError = previous?.hasError ?? false;
  const prevActivityIds = previous?.activityIds ?? EMPTY_IDS;
  const seenActivityIds = new Set(prevActivityIds);
  let nextSyntheticSequence = previous?.nextSyntheticSequence ?? 0;
  const nextSyntheticId = () => {
    const id = `subagent-log:${agent.id}:${nextSyntheticSequence}`;
    nextSyntheticSequence += 1;
    return id;
  };

  let changed = previous === undefined;
  const entries = [...prevEntries];
  const additions: SubagentLogEntry[] = [];
  const activityIds = [...prevActivityIds];

  for (const toolEntry of toolEntries) {
    if (seenActivityIds.has(toolEntry.id)) {
      continue;
    }
    seenActivityIds.add(toolEntry.id);
    additions.push(toolEntry.entry);
    activityIds.push(toolEntry.id);
    changed = true;
  }

  // New ticks: ring entries whose summary was not in the previously observed
  // ring. Matching by summary (not at) survives stable-id upserts sliding
  // createdAt; a genuine repeat (progress A → B → A) still lands because the
  // intermediate observation replaced the ring. First sight seeds from the
  // current ring — the only history available for an agent that predates
  // this log.
  for (const tick of agent.recentActivity) {
    if (prevRingSet?.has(tick.summary)) {
      continue;
    }
    additions.push(subagentLogEntryFromActivity(nextSyntheticId(), tick.at, tick.summary));
    changed = true;
  }

  const statusSummary = statusEntrySummary(prevStatus, agent);
  if (statusSummary !== null) {
    additions.push({
      id: nextSyntheticId(),
      at: agent.completedAt ?? agent.updatedAt,
      summary: statusSummary,
      kind: "status",
    });
    changed = true;
  }

  // Result/error text appears once per activation (reactivation clears both
  // in the fold, so the flags reset with them).
  const hasResult = agent.result !== null;
  if (hasResult && !prevHasResult && agent.result) {
    additions.push({
      id: nextSyntheticId(),
      at: agent.completedAt ?? agent.updatedAt,
      summary: agent.result,
      kind: "result",
    });
    changed = true;
  }
  const hasError = agent.error !== null;
  if (hasError && !prevHasError && agent.error) {
    additions.push({
      id: nextSyntheticId(),
      at: agent.completedAt ?? agent.updatedAt,
      summary: agent.error,
      kind: "error",
    });
    changed = true;
  }

  // A natural-language progress update is strictly richer than an adjacent
  // provider heartbeat ("Bash"). When both land in one render snapshot, keep
  // the action and drop the generic line. The exact timestamp match avoids
  // hiding distinct commands when no richer provider text exists.
  const richTimes = new Set(
    additions.filter((entry) => entry.kind === "activity").map((entry) => entry.at),
  );
  const orderedAdditions = additions
    .filter(
      (entry) => entry.kind !== "tool" || entry.detail !== undefined || !richTimes.has(entry.at),
    )
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.at.localeCompare(b.entry.at) || a.index - b.index)
    .map(({ entry }) => entry);
  for (const entry of orderedAdditions) {
    const previousEntry = entries.at(-1);
    if (
      entry.kind === "activity" &&
      previousEntry?.kind === "tool" &&
      previousEntry.detail === undefined &&
      previousEntry.at === entry.at
    ) {
      entries.pop();
    }
    appendBounded(entries, entry);
  }

  const ringChanged =
    prevRing === undefined ||
    prevRing.length !== agent.recentActivity.length ||
    agent.recentActivity.some((tick, index) => prevRing[index] !== tick.summary);

  if (
    !changed &&
    !ringChanged &&
    prevStatus === agent.status &&
    prevHasResult === hasResult &&
    prevHasError === hasError
  ) {
    return null;
  }

  return {
    entries,
    ringSummaries: agent.recentActivity.map((tick) => tick.summary),
    lastStatus: agent.status,
    hasResult,
    hasError,
    activityIds: activityIds.slice(-ENTRY_LIMIT),
    nextSyntheticSequence,
  };
}

/**
 * Diffs the fold output against the last observation and returns a log with
 * the new ticks appended. Returns `previous` untouched when nothing changed.
 * Agents absent from the roster keep their recorded history (retention can
 * drop settled agents from the fold while the panel still shows them).
 */
export function advanceSubagentActivityLog(
  previous: SubagentActivityLog,
  agents: ReadonlyArray<RuntimeSubagent>,
  activities: ReadonlyArray<OrchestrationThreadActivity> = [],
): SubagentActivityLog {
  const toolsByAgent = attributedToolEntries(activities);
  let next: Map<string, SubagentActivityLogState> | null = null;
  for (const agent of agents) {
    const advanced = advanceAgent(previous.get(agent.id), agent, toolsByAgent.get(agent.id) ?? []);
    if (advanced !== null) {
      next ??= new Map(previous);
      next.set(agent.id, advanced);
    }
  }
  return next ?? previous;
}
