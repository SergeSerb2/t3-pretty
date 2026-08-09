/**
 * Session-scoped history for the Agents panel's per-agent sub-thread view.
 *
 * The native subagent fold (subagentRuntime.ts) is latest-state only by
 * design: ingestion upserts task.progress / tool.progress under stable
 * per-task activity ids, so a re-fold can never see more than the newest
 * tick per agent. Depth therefore has to be accumulated at observation time:
 * every time the fold output changes, `advanceSubagentActivityLog` diffs each
 * agent against what it recorded last and appends the new ticks — progress
 * summaries, tool heartbeats, status transitions, results — to a bounded
 * per-agent log.
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
import type { RuntimeSubagent, RuntimeSubagentStatus } from "./subagentRuntime.ts";
import { isTerminalSubagentStatus } from "./subagentRuntime.ts";

export type SubagentLogEntryKind = "activity" | "status" | "result" | "error";

export interface SubagentLogEntry {
  readonly at: string;
  readonly summary: string;
  readonly kind: SubagentLogEntryKind;
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
}

export type SubagentActivityLog = ReadonlyMap<string, SubagentActivityLogState>;

const EMPTY_LOG: SubagentActivityLog = new Map();

export function emptySubagentActivityLog(): SubagentActivityLog {
  return EMPTY_LOG;
}

/** Per-agent cap. Old entries fall off the front; the feed is a tail view. */
const ENTRY_LIMIT = 100;

const EMPTY_ENTRIES: ReadonlyArray<SubagentLogEntry> = [];

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
): SubagentActivityLogState | null {
  const prevEntries = previous?.entries ?? EMPTY_ENTRIES;
  const prevRing = previous?.ringSummaries;
  const prevRingSet = prevRing === undefined ? undefined : new Set(prevRing);
  const prevStatus = previous?.lastStatus ?? "pending";
  const prevHasResult = previous?.hasResult ?? false;
  const prevHasError = previous?.hasError ?? false;

  let changed = previous === undefined;
  const entries = [...prevEntries];

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
    appendBounded(entries, { at: tick.at, summary: tick.summary, kind: "activity" });
    changed = true;
  }

  const statusSummary = statusEntrySummary(prevStatus, agent);
  if (statusSummary !== null) {
    appendBounded(entries, {
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
    appendBounded(entries, {
      at: agent.completedAt ?? agent.updatedAt,
      summary: agent.result,
      kind: "result",
    });
    changed = true;
  }
  const hasError = agent.error !== null;
  if (hasError && !prevHasError && agent.error) {
    appendBounded(entries, {
      at: agent.completedAt ?? agent.updatedAt,
      summary: agent.error,
      kind: "error",
    });
    changed = true;
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
): SubagentActivityLog {
  let next: Map<string, SubagentActivityLogState> | null = null;
  for (const agent of agents) {
    const advanced = advanceAgent(previous.get(agent.id), agent);
    if (advanced !== null) {
      next ??= new Map(previous);
      next.set(agent.id, advanced);
    }
  }
  return next ?? previous;
}
