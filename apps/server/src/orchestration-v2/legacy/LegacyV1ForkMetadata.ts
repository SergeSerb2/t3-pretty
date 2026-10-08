/** Preserve the shipped fork activity fold during the V1 history cutover. */
import {
  EventId,
  NodeId,
  PlanId,
  ProviderDriverKind,
  TurnItemId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Subagent,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { classifyImageToolItemType, extractGeneratedImagePath } from "@t3tools/shared/imageTool";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export interface LegacyForkActivity {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly ordinal: number;
  readonly turnId?: string | null;
}

type RuntimeSubagentStatus =
  | "pending"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

interface SubagentUsage {
  readonly totalTokens: number;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly toolUses?: number;
  readonly durationMs?: number;
}

interface SubagentActivityEntry {
  readonly at: string;
  readonly summary: string;
}

interface SubagentWorkflowPhase {
  readonly index: number;
  readonly title: string;
}

interface SubagentRunHandles {
  readonly runId?: string;
  readonly scriptPath?: string;
  readonly transcriptDir?: string;
  readonly sessionUrl?: string;
}

interface RuntimeSubagent {
  readonly id: string;
  readonly kind: "subagent" | "subagent_batch" | "workflow" | "workflow_agent";
  readonly title: string;
  readonly role: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly status: RuntimeSubagentStatus;
  readonly activationCount: number;
  readonly usage: SubagentUsage | null;
  readonly progress: string | null;
  readonly lastToolName: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly outputFile: string | null;
  readonly parentAgentId: string | null;
  readonly agentIndex: number | null;
  readonly phaseIndex: number | null;
  readonly phaseTitle: string | null;
  readonly attempt: number | null;
  readonly workflowName: string | null;
  readonly phases: ReadonlyArray<SubagentWorkflowPhase>;
  readonly runHandles: SubagentRunHandles | null;
  readonly recentActivity: ReadonlyArray<SubagentActivityEntry>;
  /** First retained observation, used as the roster's stable display order. */
  readonly firstSeenAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
}

const TERMINAL_STATUSES: ReadonlySet<RuntimeSubagentStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

function isTerminalSubagentStatus(status: RuntimeSubagentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Active = the user may still need to care while it runs. Idle is settled-ish
 * but resumable; waiting counts as active because it needs the user. */
function isActiveSubagentStatus(status: RuntimeSubagentStatus): boolean {
  return status === "pending" || status === "running" || status === "waiting";
}

const RECENT_ACTIVITY_LIMIT = 6;
const SUMMARY_CHAR_LIMIT = 180;
const ROSTER_LIMIT = 100;

/**
 * True when this activity's payload does NOT belong on the Agents surface.
 * Classification happens exactly once, server-side at ingestion
 * (classifyTaskAgentKind → the persisted agentKind stamp); the client only
 * reads it. Rows without a stamp — legacy threads, pre-stamp servers — are
 * background by definition: they render in the ordinary work log, exactly
 * as they did before this feature existed.
 */
function isBackgroundTaskActivity(payload: Record<string, unknown>): boolean {
  return payload.agentKind !== "agent";
}

function bounded(value: string): string {
  return value.length <= SUMMARY_CHAR_LIMIT ? value : `${value.slice(0, SUMMARY_CHAR_LIMIT - 1)}…`;
}

/** Appends to the ring buffer, deduping consecutive identical summaries. */
function appendActivity(
  entries: ReadonlyArray<SubagentActivityEntry>,
  at: string,
  summary: string,
): ReadonlyArray<SubagentActivityEntry> {
  const boundedSummary = bounded(summary);
  if (entries.length > 0 && entries[entries.length - 1]?.summary === boundedSummary) {
    return entries;
  }
  const next = [...entries, { at, summary: boundedSummary }];
  return next.length > RECENT_ACTIVITY_LIMIT ? next.slice(-RECENT_ACTIVITY_LIMIT) : next;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asUsage(value: unknown): SubagentUsage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const totalTokens = asCount(record.totalTokens);
  if (totalTokens === undefined) {
    return undefined;
  }
  const usage: {
    totalTokens: number;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
    toolUses?: number;
    durationMs?: number;
  } = { totalTokens };
  const inputTokens = asCount(record.inputTokens);
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  const cachedInputTokens = asCount(record.cachedInputTokens);
  if (cachedInputTokens !== undefined) usage.cachedInputTokens = cachedInputTokens;
  const outputTokens = asCount(record.outputTokens);
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  const reasoningOutputTokens = asCount(record.reasoningOutputTokens);
  if (reasoningOutputTokens !== undefined) usage.reasoningOutputTokens = reasoningOutputTokens;
  const toolUses = asCount(record.toolUses);
  if (toolUses !== undefined) usage.toolUses = toolUses;
  const durationMs = asCount(record.durationMs);
  if (durationMs !== undefined) usage.durationMs = durationMs;
  return usage;
}

/**
 * Provider-specific usage merge (#4779 semantics, verbatim):
 * - max-merge (Codex-style cumulative frames): field-wise maximum, idempotent
 *   under duplicate or late frames. Cumulative totals never shrink.
 * - accumulate (Claude-style activation deltas): not needed at this layer —
 *   Claude's task_progress usage is itself cumulative per task, so the fold
 *   also max-merges. The distinction matters when v2 sums activations.
 * Field-wise: a terminal payload carrying only totalTokens must not wipe a
 * known breakdown.
 */
function mergeUsageMax(
  current: SubagentUsage | null,
  incoming: SubagentUsage | undefined,
): SubagentUsage | null {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  const pick = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined ? b : b === undefined ? a : Math.max(a, b);
  const merged: {
    totalTokens: number;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
    toolUses?: number;
    durationMs?: number;
  } = { totalTokens: Math.max(current.totalTokens, incoming.totalTokens) };
  const inputTokens = pick(current.inputTokens, incoming.inputTokens);
  if (inputTokens !== undefined) merged.inputTokens = inputTokens;
  const cachedInputTokens = pick(current.cachedInputTokens, incoming.cachedInputTokens);
  if (cachedInputTokens !== undefined) merged.cachedInputTokens = cachedInputTokens;
  const outputTokens = pick(current.outputTokens, incoming.outputTokens);
  if (outputTokens !== undefined) merged.outputTokens = outputTokens;
  const reasoningOutputTokens = pick(current.reasoningOutputTokens, incoming.reasoningOutputTokens);
  if (reasoningOutputTokens !== undefined) merged.reasoningOutputTokens = reasoningOutputTokens;
  const toolUses = pick(current.toolUses, incoming.toolUses);
  if (toolUses !== undefined) merged.toolUses = toolUses;
  const durationMs = pick(current.durationMs, incoming.durationMs);
  if (durationMs !== undefined) merged.durationMs = durationMs;
  return merged;
}

interface MutableAgent {
  id: string;
  kind: RuntimeSubagent["kind"];
  title: string;
  role: string | null;
  model: string | null;
  effort: string | null;
  status: RuntimeSubagentStatus;
  activationCount: number;
  usage: SubagentUsage | null;
  progress: string | null;
  lastToolName: string | null;
  result: string | null;
  error: string | null;
  outputFile: string | null;
  parentAgentId: string | null;
  agentIndex: number | null;
  phaseIndex: number | null;
  phaseTitle: string | null;
  attempt: number | null;
  workflowName: string | null;
  phases: ReadonlyArray<SubagentWorkflowPhase>;
  runHandles: SubagentRunHandles | null;
  recentActivity: ReadonlyArray<SubagentActivityEntry>;
  firstSeenAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

function kindFromPayload(
  payload: Record<string, unknown>,
  agentId: string,
): RuntimeSubagent["kind"] {
  if (payload.taskType === "subagent_batch") {
    return "subagent_batch";
  }
  if (asString(payload.taskType) === "local_workflow") {
    return "workflow";
  }
  if (payload.parentAgentId !== undefined || agentId.includes(":wf:")) {
    return "workflow_agent";
  }
  return "subagent";
}

/** Completion can create an agent (its start may have aged out of retention). */
function getOrCreate(
  agents: Map<string, MutableAgent>,
  id: string,
  payload: Record<string, unknown>,
  at: string,
): MutableAgent {
  const existing = agents.get(id);
  if (existing) {
    return existing;
  }
  const created: MutableAgent = {
    id,
    kind: kindFromPayload(payload, id),
    title: asString(payload.title) ?? asString(payload.detail) ?? id,
    role: asString(payload.role) ?? null,
    model: asString(payload.model) ?? null,
    effort: asString(payload.effort) ?? null,
    status: "pending",
    activationCount: 0,
    usage: null,
    progress: null,
    lastToolName: null,
    result: null,
    error: null,
    outputFile: null,
    parentAgentId: asString(payload.parentAgentId) ?? null,
    agentIndex: asCount(payload.agentIndex) ?? null,
    phaseIndex: asCount(payload.phaseIndex) ?? null,
    phaseTitle: asString(payload.phaseTitle) ?? null,
    attempt: asCount(payload.attempt) ?? null,
    workflowName: asString(payload.workflowName) ?? null,
    phases: [],
    runHandles: null,
    recentActivity: [],
    firstSeenAt: at,
    startedAt: null,
    completedAt: null,
    updatedAt: at,
  };
  agents.set(id, created);
  return created;
}

/** Metadata fill from any payload: never downgrades known values to null. */
function fillMetadata(agent: MutableAgent, payload: Record<string, unknown>): void {
  if (payload.taskType === "subagent_batch") agent.kind = "subagent_batch";
  const title = asString(payload.title);
  if (title) agent.title = title;
  const role = asString(payload.role);
  if (role) agent.role = role;
  const model = asString(payload.model);
  if (model) agent.model = model;
  const effort = asString(payload.effort);
  if (effort) agent.effort = effort;
  const parentAgentId = asString(payload.parentAgentId);
  if (parentAgentId) {
    agent.parentAgentId = parentAgentId;
    if (agent.kind === "subagent") agent.kind = "workflow_agent";
  }
  const workflowName = asString(payload.workflowName);
  if (workflowName) agent.workflowName = workflowName;
  if (asString(payload.taskType) === "local_workflow") agent.kind = "workflow";
  const agentIndex = asCount(payload.agentIndex);
  if (agentIndex !== undefined) agent.agentIndex = agentIndex;
  const phaseIndex = asCount(payload.phaseIndex);
  if (phaseIndex !== undefined) agent.phaseIndex = phaseIndex;
  const phaseTitle = asString(payload.phaseTitle);
  if (phaseTitle) agent.phaseTitle = phaseTitle;
  const attempt = asCount(payload.attempt);
  if (attempt !== undefined) {
    // A new attempt on a workflow slot is a reactivation of the same
    // identity: clear the previous attempt's terminal detail so the status
    // transition (terminal → running, in applyStatus) reads as a fresh run.
    // The activation bump lives ONLY in applyStatus — bumping here too
    // counted every retry twice (review finding: two attempts read "run 3").
    if (agent.attempt !== null && attempt > agent.attempt) {
      agent.result = null;
      agent.error = null;
      agent.completedAt = null;
    }
    agent.attempt = attempt;
  }
  const outputFile = asString(payload.outputFile);
  if (outputFile) agent.outputFile = outputFile;
  if (Array.isArray(payload.phases)) {
    const phases: SubagentWorkflowPhase[] = [];
    for (const entry of payload.phases) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const index = asCount(record.index);
      const phaseName = asString(record.title);
      if (index !== undefined && phaseName) {
        phases.push({ index, title: phaseName });
      }
    }
    if (phases.length > 0) {
      agent.phases = phases.slice().sort((a, b) => a.index - b.index);
    }
  }
  if (typeof payload.runHandles === "object" && payload.runHandles !== null) {
    const record = payload.runHandles as Record<string, unknown>;
    const runHandles: {
      runId?: string;
      scriptPath?: string;
      transcriptDir?: string;
      sessionUrl?: string;
    } = {};
    const runId = asString(record.runId);
    if (runId) runHandles.runId = runId;
    const scriptPath = asString(record.scriptPath);
    if (scriptPath) runHandles.scriptPath = scriptPath;
    const transcriptDir = asString(record.transcriptDir);
    if (transcriptDir) runHandles.transcriptDir = transcriptDir;
    // Defense-in-depth: the adapter already sanitizes, but payloads are not
    // schema-validated on the read path (shipped XSS lesson).
    const sessionUrl = asString(record.sessionUrl);
    if (sessionUrl && /^https?:\/\//i.test(sessionUrl)) runHandles.sessionUrl = sessionUrl;
    if (Object.keys(runHandles).length > 0) {
      agent.runHandles = { ...agent.runHandles, ...runHandles };
    }
  }
}

function applyStatus(agent: MutableAgent, status: RuntimeSubagentStatus, at: string): void {
  const wasTerminal = isTerminalSubagentStatus(agent.status);
  const isTerminal = isTerminalSubagentStatus(status);
  if (wasTerminal && isTerminal) {
    // Duplicate terminal events are idempotent: first write wins, timestamps
    // don't slide.
    return;
  }
  if ((wasTerminal || agent.status === "idle") && (status === "running" || status === "pending")) {
    // Reactivation: same identity, new run. Clear the previous run's terminal
    // detail so a live card never shows the prior run's output.
    agent.activationCount += 1;
    agent.result = null;
    agent.error = null;
    agent.completedAt = null;
    if (status === "running") {
      agent.startedAt = at;
    }
  }
  if (status === "running" && agent.startedAt === null) {
    agent.startedAt = at;
  }
  if (isTerminal && agent.completedAt === null) {
    agent.completedAt = at;
  }
  agent.status = status;
}

// Map, not object literal: payloads aren't schema-validated on the read
// path, so a status like "toString" must miss instead of resolving an
// inherited Function through the prototype chain.
const TASK_COMPLETED_STATUS: ReadonlyMap<string, RuntimeSubagentStatus> = new Map([
  ["completed", "completed"],
  ["failed", "failed"],
  ["stopped", "interrupted"],
]);

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "running",
  "waiting",
  "idle",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

function asRuntimeStatus(value: unknown): RuntimeSubagentStatus | undefined {
  return typeof value === "string" && KNOWN_STATUSES.has(value)
    ? (value as RuntimeSubagentStatus)
    : undefined;
}

/**
 * Folds a thread's persisted activities into subagent state. Tolerant by
 * construction: malformed rows are skipped individually; unknown kinds are
 * ignored. Pure — memoize by activity-list identity at the atom layer.
 *
 * sessionLive=false derives interruption: background tasks die with their
 * provider session, so agents whose terminal rows were lost (server
 * restart, crash) must not read as running forever (review finding: a dead
 * session left a panel full of "Working" agents while the sidebar showed
 * nothing). Idle is preserved — a resumable Codex child stays resumable.
 */
export function foldSubagentActivities(
  activities: ReadonlyArray<LegacyForkActivity>,
  options?: { readonly sessionLive?: boolean },
): ReadonlyArray<RuntimeSubagent> {
  const agents = new Map<string, MutableAgent>();

  for (const activity of activities) {
    if (typeof activity.payload !== "object" || activity.payload === null) {
      continue;
    }
    const payload = activity.payload as Record<string, unknown>;
    const at = activity.createdAt;

    switch (activity.kind) {
      case "task.started": {
        const taskId = asString(payload.taskId);
        if (!taskId) break;
        // Only real agents join the roster. Shells, monitors, and plan-mode
        // tasks are background work — they render in the ordinary work log,
        // not the Agents surface (a "Run 12s stall" shell is not a subagent).
        if (isBackgroundTaskActivity(payload)) break;
        const agent = getOrCreate(agents, taskId, payload, at);
        fillMetadata(agent, payload);
        // Order-robustness: a start row arriving after a terminal state is a
        // late/out-of-order delivery and only fills metadata — it must not
        // reopen the run. Reactivation comes exclusively from explicit
        // status transitions (task.updated / progress status). Guard on the
        // status itself, not activationCount: a task first seen via a
        // terminal task.updated has zero activations but is still settled
        // (review finding: a late start reopened a failed child).
        if (agent.activationCount === 0 && !isTerminalSubagentStatus(agent.status)) {
          agent.activationCount = 1;
          agent.startedAt = agent.startedAt ?? at;
          agent.status = "running";
        } else if (agent.status === "idle") {
          applyStatus(agent, "running", at);
        }
        const detail = asString(payload.detail);
        if (detail && agent.title === agent.id) agent.title = detail;
        agent.updatedAt = at;
        break;
      }
      case "task.progress": {
        const taskId = asString(payload.taskId);
        if (!taskId) break;
        // Membership is sticky per taskId: rows after the first (terminal
        // rows often carry only taskId+status, no marker fields) inherit the
        // first row's classification instead of being re-judged.
        const existed = agents.has(taskId);
        if (!existed && isBackgroundTaskActivity(payload)) break;
        const agent = getOrCreate(agents, taskId, payload, at);
        fillMetadata(agent, payload);
        if (agent.activationCount === 0) agent.activationCount = 1;
        const explicitStatus = asRuntimeStatus(payload.status);
        if (explicitStatus) {
          applyStatus(agent, explicitStatus, at);
        } else if (
          (payload.usageSnapshot !== true || !existed) &&
          !isTerminalSubagentStatus(agent.status) &&
          agent.status !== "idle"
        ) {
          applyStatus(agent, "running", at);
        }
        const detail = asString(payload.detail);
        const summary =
          asString(payload.summary) ??
          (detail !== agent.title && detail !== asString(payload.description) ? detail : undefined);
        if (summary) {
          agent.progress = bounded(summary);
          agent.recentActivity = appendActivity(agent.recentActivity, at, summary);
        }
        const lastToolName = asString(payload.lastToolName);
        if (lastToolName) {
          agent.lastToolName = lastToolName;
          if (!summary) {
            agent.recentActivity = appendActivity(agent.recentActivity, at, `▸ ${lastToolName}`);
          }
        }
        const error = asString(payload.error);
        if (error) agent.error = bounded(error);
        agent.usage = mergeUsageMax(agent.usage, asUsage(payload.typedUsage));
        agent.updatedAt = at;
        break;
      }
      case "task.updated": {
        const taskId = asString(payload.taskId);
        if (!taskId) break;
        // Membership is sticky per taskId: rows after the first (terminal
        // rows often carry only taskId+status, no marker fields) inherit the
        // first row's classification instead of being re-judged.
        if (!agents.has(taskId) && isBackgroundTaskActivity(payload)) break;
        const agent = getOrCreate(agents, taskId, payload, at);
        fillMetadata(agent, payload);
        const detail = asString(payload.detail);
        if (detail) agent.progress = bounded(detail);
        // A task first seen via task.updated (start row aged out) has run at
        // least once — zero activations would misreport "run 0" and let a
        // later start row treat it as never-started (review finding).
        if (agent.activationCount === 0) agent.activationCount = 1;
        const wasTerminal = isTerminalSubagentStatus(agent.status);
        const status = asRuntimeStatus(payload.status);
        if (status) applyStatus(agent, status, at);
        const error = asString(payload.error);
        if (error) agent.error = bounded(error);
        // Provider end time beats ingestion time for the transition that
        // actually settled the run (applyStatus fills completedAt with the
        // activity timestamp first, so check the transition, not null).
        const endedAt = asString(payload.endedAt);
        if (endedAt && !wasTerminal && isTerminalSubagentStatus(agent.status)) {
          agent.completedAt = endedAt;
        }
        agent.updatedAt = at;
        break;
      }
      case "task.completed": {
        const taskId = asString(payload.taskId);
        if (!taskId) break;
        // Membership is sticky per taskId: rows after the first (terminal
        // rows often carry only taskId+status, no marker fields) inherit the
        // first row's classification instead of being re-judged.
        if (!agents.has(taskId) && isBackgroundTaskActivity(payload)) break;
        const agent = getOrCreate(agents, taskId, payload, at);
        fillMetadata(agent, payload);
        if (agent.activationCount === 0) agent.activationCount = 1;
        // Already-terminal: status and timestamps are frozen (first write
        // wins, duplicates must not slide them) but the completion still
        // ENRICHES — Claude commonly emits terminal task.updated before
        // task.completed, and the completion carries the result summary and
        // final usage the update lacked (review finding: the early return
        // dropped both). Fill-if-missing keeps duplicate completions from
        // replacing the first result.
        const summary = asString(payload.summary) ?? asString(payload.detail);
        if (isTerminalSubagentStatus(agent.status)) {
          if (summary) {
            if (agent.status === "failed") {
              agent.error = agent.error ?? bounded(summary);
            } else {
              agent.result = agent.result ?? bounded(summary);
            }
          }
          agent.usage = mergeUsageMax(agent.usage, asUsage(payload.typedUsage));
          break;
        }
        const status = TASK_COMPLETED_STATUS.get(asString(payload.status) ?? "") ?? "completed";
        applyStatus(agent, status, at);
        if (summary) {
          if (status === "failed") {
            agent.error = agent.error ?? bounded(summary);
          } else {
            agent.result = bounded(summary);
          }
        }
        agent.usage = mergeUsageMax(agent.usage, asUsage(payload.typedUsage));
        agent.updatedAt = at;
        break;
      }
      case "tool.progress": {
        // Agent-owned heartbeat: "what it's doing right now".
        const taskId = asString(payload.taskId);
        if (!taskId) break;
        const agent = agents.get(taskId);
        if (!agent) break;
        const toolName = asString(payload.toolName);
        if (toolName) {
          agent.lastToolName = toolName;
          agent.recentActivity = appendActivity(agent.recentActivity, at, `▸ ${toolName}`);
        }
        agent.updatedAt = at;
        break;
      }
      default:
        break;
    }
  }

  // Consistency pass: when a workflow coordinator has settled, members that
  // never received their own terminal row cannot still be in-flight — the
  // run is over. Cascade the coordinator's outcome so stalled member rows
  // don't read as working forever (live-test finding: statuses drifted
  // whenever member terminal rows were lost or never emitted).
  for (const agent of agents.values()) {
    if (agent.kind !== "workflow" || !isTerminalSubagentStatus(agent.status)) {
      continue;
    }
    for (const member of agents.values()) {
      if (member.parentAgentId !== agent.id) {
        continue;
      }
      if (isTerminalSubagentStatus(member.status) || member.status === "idle") {
        continue;
      }
      member.status = agent.status === "completed" ? "completed" : "interrupted";
      member.completedAt = member.completedAt ?? agent.completedAt ?? agent.updatedAt;
      member.updatedAt = agent.updatedAt;
    }
  }

  // Session death orphans every live agent: no process remains to finish
  // them. Mirrors the server-side liveness registry clearing on
  // session.exited, so panel and sidebar can never disagree.
  if (options?.sessionLive === false) {
    for (const agent of agents.values()) {
      if (isActiveSubagentStatus(agent.status)) {
        agent.status = "interrupted";
        agent.completedAt = agent.completedAt ?? agent.updatedAt;
      }
    }
  }

  let roster = Array.from(agents.values());
  if (roster.length > ROSTER_LIMIT) {
    // Prefer live, then waiting/idle, then newest settled.
    const rank = (agent: MutableAgent): number =>
      isActiveSubagentStatus(agent.status) ? 0 : agent.status === "idle" ? 1 : 2;
    roster = roster
      .slice()
      .sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, ROSTER_LIMIT);
  }

  return roster.map((agent) => ({ ...agent }));
}

const PREFIX = "migration:v1:fork";
const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const planPayload = Schema.Struct({
  plan: Schema.Array(
    Schema.Struct({
      step: Schema.String,
      status: Schema.Literals(["pending", "inProgress", "completed"]),
    }),
  ),
  explanation: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodePlan = Schema.decodeUnknownOption(planPayload);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function at(value: string | null, fallback: DateTime.Utc): DateTime.Utc | null {
  return value === null ? null : Option.getOrElse(DateTime.make(value), () => fallback);
}
function activityItemBase(thread: OrchestrationV2AppThread, activity: LegacyForkActivity) {
  const updatedAt = at(activity.createdAt, thread.updatedAt)!;
  return {
    id: TurnItemId.make(`${PREFIX}:activity:${activity.id}`),
    threadId: thread.id,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: activity.ordinal,
    status: "completed" as const,
    title: activity.summary || null,
    startedAt: updatedAt,
    completedAt: updatedAt,
    updatedAt,
  };
}

/** Deterministic history records. Native task references are intentionally absent: these are
 * imported observations, not newly scheduled work or provider continuation handles. */
export function legacyV1ForkMetadata(
  thread: OrchestrationV2AppThread,
  activities: ReadonlyArray<LegacyForkActivity>,
  driver = ProviderDriverKind.make("legacy"),
): {
  readonly thread: OrchestrationV2AppThread;
  readonly events: ReadonlyArray<OrchestrationV2DomainEvent>;
  readonly imagePositions: ReadonlyArray<{ readonly id: TurnItemId; readonly at: string }>;
  readonly itemPositions: ReadonlyArray<{ readonly id: TurnItemId; readonly at: string }>;
} {
  const events: OrchestrationV2DomainEvent[] = [];
  const agents = foldSubagentActivities(activities, { sessionLive: false });
  const rootNodeId = NodeId.make(`${PREFIX}:root:${thread.id}`);
  const nodeIdFor = (id: string) => NodeId.make(`${PREFIX}:agent:${thread.id}:${id}`);
  if (agents.length > 0 || activities.some((activity) => activity.kind === "turn.plan.updated"))
    events.push({
      id: EventId.make(`${PREFIX}:root:${thread.id}`),
      type: "node.updated",
      threadId: thread.id,
      occurredAt: thread.updatedAt,
      payload: {
        id: rootNodeId,
        threadId: thread.id,
        runId: null,
        parentNodeId: null,
        rootNodeId,
        kind: "system",
        status: "completed",
        countsForRun: false,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: null,
        checkpointScopeId: null,
        startedAt: thread.createdAt,
        completedAt: thread.updatedAt,
      },
    });
  for (const agent of agents) {
    const nodeId = nodeIdFor(agent.id);
    const parentAgentId = agent.parentAgentId === null ? null : nodeIdFor(agent.parentAgentId);
    const parentNodeId = parentAgentId ?? rootNodeId;
    const updatedAt = at(agent.updatedAt, thread.updatedAt)!;
    const startedAt = at(agent.startedAt, thread.createdAt);
    const completedAt = at(agent.completedAt, thread.updatedAt);
    const subagent: OrchestrationV2Subagent = {
      ...agent,
      id: nodeId,
      threadId: thread.id,
      runId: null,
      parentNodeId,
      parentAgentId,
      origin: "provider_native",
      createdBy: "agent",
      driver,
      providerInstanceId: thread.providerInstanceId,
      providerThreadId: null,
      childThreadId: null,
      nativeTaskRef: null,
      prompt: "",
      progress: agent.progress ?? undefined,
      recentActivity: agent.recentActivity.map((entry) => ({
        ...entry,
        at: DateTime.formatIso(at(entry.at, thread.updatedAt)!),
      })),
      startedAt,
      completedAt,
      updatedAt,
    };
    events.push(
      {
        id: EventId.make(`${PREFIX}:node:${thread.id}:${agent.id}`),
        type: "node.updated",
        threadId: thread.id,
        occurredAt: updatedAt,
        payload: {
          id: nodeId,
          threadId: thread.id,
          runId: null,
          parentNodeId,
          rootNodeId,
          kind: "subagent",
          status: agent.status,
          countsForRun: false,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          runtimeRequestId: null,
          checkpointScopeId: null,
          startedAt,
          completedAt,
        },
      },
      {
        id: EventId.make(`${PREFIX}:agent:${thread.id}:${agent.id}`),
        type: "subagent.updated",
        threadId: thread.id,
        occurredAt: updatedAt,
        payload: subagent,
      },
    );
  }
  let liveHeadline: string | null | undefined;
  let planProgress: OrchestrationV2AppThread["planProgress"] = undefined;
  const plans = new Map<
    string,
    {
      activity: LegacyForkActivity;
      firstAt: DateTime.Utc;
      plan: typeof planPayload.Type;
      anchors: Map<string, DateTime.Utc>;
      durations: Map<string, number>;
    }
  >();
  const images = new Map<
    string,
    {
      activity: LegacyForkActivity;
      firstAt: DateTime.Utc;
      payload: Record<string, unknown>;
      savedPath: string | undefined;
    }
  >();
  for (const activity of activities) {
    const payload = record(activity.payload);
    if (activity.kind === "turn.headline") liveHeadline = asString(activity.summary) ?? null;
    if (activity.kind === "turn.plan.updated") {
      const plan = Option.getOrNull(decodePlan(payload));
      if (plan !== null) {
        const key = activity.turnId ?? activity.id;
        const previous = plans.get(key);
        const now = at(activity.createdAt, thread.updatedAt)!;
        const firstAt = previous?.firstAt ?? now;
        const anchors = previous?.anchors ?? new Map<string, DateTime.Utc>();
        const durations = previous?.durations ?? new Map<string, number>();
        const occurrences = new Map<string, number>();
        let previousCompletedAt = firstAt;
        for (const step of plan.plan) {
          const occurrence = occurrences.get(step.step) ?? 0;
          occurrences.set(step.step, occurrence + 1);
          const stepKey = `${step.step}:${occurrence}`;
          if (step.status === "inProgress" && !anchors.has(stepKey)) anchors.set(stepKey, now);
          if (step.status === "completed") {
            if (!durations.has(stepKey))
              durations.set(
                stepKey,
                Math.max(
                  0,
                  DateTime.toEpochMillis(now) -
                    DateTime.toEpochMillis(anchors.get(stepKey) ?? previousCompletedAt),
                ),
              );
            previousCompletedAt = now;
          }
        }
        plans.set(key, { activity, firstAt, plan, anchors, durations });
        const current =
          plan.plan.find((step) => step.status === "inProgress") ??
          plan.plan.find((step) => step.status === "pending");
        planProgress =
          current === undefined
            ? null
            : {
                step: current.step,
                completedSteps: plan.plan.filter((step) => step.status === "completed").length,
                totalSteps: plan.plan.length,
              };
      }
    }
    if (!activity.kind.startsWith("tool.") && !activity.kind.startsWith("item.")) continue;
    const data = record(payload.data);
    const imageKind = classifyImageToolItemType({
      type: asString(payload.itemType),
      toolName: asString(payload.toolName) ?? asString(data.toolName),
      title: asString(payload.title) ?? activity.summary,
      kind: asString(data.type),
    });
    if (imageKind !== "image_generation") continue;
    const savedPath = extractGeneratedImagePath({
      data: payload,
      detail: asString(payload.detail),
    });
    const key = asString(payload.toolCallId) ?? asString(data.toolCallId) ?? activity.id;
    const previous = images.get(key);
    images.set(key, {
      activity,
      firstAt: previous?.firstAt ?? at(activity.createdAt, thread.updatedAt)!,
      payload: {
        ...previous?.payload,
        ...payload,
        data: { ...record(previous?.payload.data), ...data },
      },
      savedPath: savedPath ?? previous?.savedPath,
    });
  }
  const imagePositions: Array<{ id: TurnItemId; at: string }> = [];
  for (const [key, image] of [...images].sort(
    ([, left], [, right]) =>
      DateTime.toEpochMillis(left.firstAt) - DateTime.toEpochMillis(right.firstAt) ||
      left.activity.id.localeCompare(right.activity.id),
  )) {
    const { activity, payload, savedPath } = image;
    const data = record(payload.data);
    const item: OrchestrationV2TurnItem = {
      ...activityItemBase(thread, activity),
      id: TurnItemId.make(`${PREFIX}:image-item:${thread.id}:${key}`),
      startedAt: image.firstAt,
      type: "image_generation",
      ...(savedPath === undefined ? {} : { savedPath, paths: [savedPath] }),
      ...(asString(data.prompt) === undefined ? {} : { prompt: asString(data.prompt)! }),
      ...(asString(payload.detail) === undefined ? {} : { output: asString(payload.detail)! }),
      status:
        payload.status === "failed"
          ? "failed"
          : activity.kind.endsWith("completed") || savedPath !== undefined
            ? "completed"
            : "interrupted",
    };
    imagePositions.push({ id: item.id, at: DateTime.formatIso(image.firstAt) });
    events.push({
      id: EventId.make(`${PREFIX}:image:${thread.id}:${key}`),
      type: "turn-item.updated",
      threadId: thread.id,
      occurredAt: item.updatedAt,
      payload: item,
    });
  }

  const itemPositions = [...imagePositions];
  for (const [key, history] of plans) {
    const planId = PlanId.make(`${PREFIX}:plan:${thread.id}:${key}`);
    const nodeId = NodeId.make(`${PREFIX}:plan-node:${thread.id}:${key}`);
    const updatedAt = at(history.activity.createdAt, thread.updatedAt)!;
    const occurrences = new Map<string, number>();
    const steps = history.plan.plan
      .filter((step) => step.step.trim().length > 0)
      .map((step, index) => {
        const occurrence = occurrences.get(step.step) ?? 0;
        occurrences.set(step.step, occurrence + 1);
        const stepKey = `${step.step}:${occurrence}`;
        const anchor = history.anchors.get(stepKey);
        const duration = history.durations.get(stepKey);
        return {
          id: `${planId}:step:${index}`,
          text: step.step,
          status: step.status === "inProgress" ? ("running" as const) : step.status,
          ...(anchor === undefined ? {} : { durationAnchorAt: DateTime.formatIso(anchor) }),
          ...(duration === undefined ? {} : { durationMs: duration }),
        };
      });
    const item: OrchestrationV2TurnItem = {
      ...activityItemBase(thread, history.activity),
      id: TurnItemId.make(`${PREFIX}:plan-item:${thread.id}:${key}`),
      nodeId,
      startedAt: history.firstAt,
      type: "todo_list",
      planId,
      steps,
      ...(history.plan.explanation == null ? {} : { explanation: history.plan.explanation }),
    };
    itemPositions.push({ id: item.id, at: DateTime.formatIso(history.firstAt) });
    events.push(
      {
        id: EventId.make(`${PREFIX}:plan-node:${thread.id}:${key}`),
        type: "node.updated",
        threadId: thread.id,
        occurredAt: updatedAt,
        payload: {
          id: nodeId,
          threadId: thread.id,
          runId: null,
          parentNodeId: rootNodeId,
          rootNodeId,
          kind: "todo_list",
          status: "completed",
          countsForRun: false,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          runtimeRequestId: null,
          checkpointScopeId: null,
          startedAt: history.firstAt,
          completedAt: updatedAt,
        },
      },
      {
        id: EventId.make(`${PREFIX}:plan:${thread.id}:${key}`),
        type: "plan.updated",
        threadId: thread.id,
        occurredAt: updatedAt,
        payload: {
          id: planId,
          threadId: thread.id,
          runId: null,
          nodeId,
          kind: "todo_list",
          status: steps.every((step) => step.status === "completed") ? "completed" : "active",
          steps,
          ...(history.plan.explanation == null ? {} : { explanation: history.plan.explanation }),
        },
      },
      {
        id: EventId.make(`${PREFIX}:plan-item:${thread.id}:${key}`),
        type: "turn-item.updated",
        threadId: thread.id,
        occurredAt: updatedAt,
        payload: item,
      },
    );
  }
  itemPositions.sort(
    (left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id),
  );
  const patched = {
    ...thread,
    ...(liveHeadline === undefined || thread.liveHeadline != null ? {} : { liveHeadline }),
    ...(planProgress === undefined || thread.planProgress != null ? {} : { planProgress }),
  };
  if (liveHeadline !== undefined || planProgress !== undefined)
    events.push({
      id: EventId.make(`${PREFIX}:metadata:${thread.id}`),
      type: "thread.metadata-updated",
      threadId: thread.id,
      occurredAt: thread.updatedAt,
      payload: patched,
    });
  return { thread: patched, events, imagePositions, itemPositions };
}

/** Call with the current V2 thread when backfilling a shell imported by an earlier build.
 * Existing deterministic event IDs are omitted, so repeat reads do not append history. */
export const loadLegacyV1ForkMetadata = Effect.fn("loadLegacyV1ForkMetadata")(function* (
  thread: OrchestrationV2AppThread,
  driver?: ProviderDriverKind,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly turn_id: string | null;
    readonly activity_id: string;
    readonly kind: string;
    readonly summary: string;
    readonly payload_json: string;
    readonly created_at: string;
    readonly ordinal: number;
  }>`
    SELECT turn_id, activity_id, kind, summary, payload_json, created_at,
      ROW_NUMBER() OVER (ORDER BY sequence, created_at, activity_id) AS ordinal
    FROM projection_thread_activities WHERE thread_id = ${thread.id}
    ORDER BY sequence, created_at, activity_id
  `;
  const metadata = legacyV1ForkMetadata(
    thread,
    rows.map((row) => ({
      id: row.activity_id,
      turnId: row.turn_id,
      kind: row.kind,
      summary: row.summary,
      payload: Option.getOrNull(decodePayload(row.payload_json)),
      createdAt: row.created_at,
      ordinal: row.ordinal,
    })),
    driver,
  );
  const messages = yield* sql<{ readonly created_at: string }>`
    SELECT created_at FROM projection_thread_messages WHERE thread_id = ${thread.id}
      AND role IN ('user', 'assistant') ORDER BY created_at, message_id
  `;
  const ordinals = new Map(
    metadata.itemPositions.map((image, index) => [
      image.id,
      messages.filter((message) => message.created_at <= image.at).length + index + 1,
    ]),
  );
  const existing = yield* sql<{ readonly event_id: string }>`
    SELECT event_id FROM orchestration_events WHERE application_event_version = 2
      AND aggregate_kind = 'thread' AND stream_id = ${thread.id} AND event_id LIKE 'migration:v1:fork:%'
  `;
  const seen = new Set(existing.map((row) => row.event_id));
  return {
    ...metadata,
    events: metadata.events
      .filter((event) => !seen.has(event.id))
      .map((event): OrchestrationV2DomainEvent =>
        event.type === "turn-item.updated" && ordinals.has(event.payload.id)
          ? { ...event, payload: { ...event.payload, ordinal: ordinals.get(event.payload.id)! } }
          : event,
      ),
  };
});
