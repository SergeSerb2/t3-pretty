import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";

import type {
  AgentActivityPhase,
  AgentActivityProps,
  AgentActivityRowProps,
} from "../../widgets/AgentActivity";
import { compareTimestamps } from "../../lib/time";

// Mirrors the relay aggregate windows (AgentActivityPublisher /
// agentActivityPayloads) so a phone that's connected to the environment can
// paint the same card without waiting on APNs.
const RUNNING_AGENT_ACTIVITY_ROW_TTL_MS = 2 * 60 * 60 * 1_000;
const WAITING_AGENT_ACTIVITY_ROW_TTL_MS = 24 * 60 * 60 * 1_000;
const TERMINAL_AGENT_ACTIVITY_DISPLAY_TTL_MS = 15 * 60 * 1_000;
const MAX_ACTIVITY_ROWS = 5;

function isTerminalPhase(phase: AgentActivityPhase): boolean {
  return phase === "completed" || phase === "failed";
}

function isActivePhase(phase: AgentActivityPhase): boolean {
  return !isTerminalPhase(phase);
}

function parseTimestampMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isExpiredRow(phase: AgentActivityPhase, updatedAt: string, nowMs: number): boolean {
  const updatedAtMs = parseTimestampMs(updatedAt);
  if (updatedAtMs === null) {
    return true;
  }
  const ttlMs =
    phase === "running" || phase === "starting"
      ? RUNNING_AGENT_ACTIVITY_ROW_TTL_MS
      : WAITING_AGENT_ACTIVITY_ROW_TTL_MS;
  return nowMs - updatedAtMs > ttlMs;
}

function isRecentTerminal(phase: AgentActivityPhase, updatedAt: string, nowMs: number): boolean {
  if (!isTerminalPhase(phase)) {
    return false;
  }
  const updatedAtMs = parseTimestampMs(updatedAt);
  if (updatedAtMs === null) {
    return false;
  }
  return nowMs - updatedAtMs <= TERMINAL_AGENT_ACTIVITY_DISPLAY_TTL_MS;
}

function statusForPhase(phase: AgentActivityPhase): string {
  switch (phase) {
    case "waiting_for_approval":
      return "Approval";
    case "waiting_for_input":
      return "Input";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "starting":
      return "Connecting";
    case "running":
      return "Working";
    case "stale":
      return "Waiting";
  }
}

export function liveActivityContentFingerprint(props: AgentActivityProps): string {
  return JSON.stringify({
    activeCount: props.activeCount,
    subtitle: props.subtitle,
    activities: props.activities.map((row) => [
      row.threadId,
      row.phase,
      row.status,
      row.threadTitle,
      row.progress ?? null,
      row.startedAt ?? null,
    ]),
  });
}

export function buildLocalLiveActivityProps(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<Pick<EnvironmentProject, "id" | "environmentId" | "title">>;
  readonly nowMs: number;
}): AgentActivityProps | null {
  const projectByKey = new Map(
    input.projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );

  const rows: AgentActivityRowProps[] = [];
  for (const thread of input.threads) {
    const project = projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
    if (!project) {
      continue;
    }
    const state = projectThreadAwarenessV2({
      environmentId: thread.environmentId,
      project,
      thread: thread.source,
    });
    if (!state) {
      continue;
    }
    // A terminal shell needs a materialized completed run before it can arm
    // a local Done card; metadata-only shells must not create lock-screen rows.
    if (
      state.phase === "completed" &&
      thread.latestRun?.status !== "completed" &&
      thread.latestRun?.completedAt == null
    ) {
      continue;
    }
    if (isActivePhase(state.phase) && isExpiredRow(state.phase, state.updatedAt, input.nowMs)) {
      continue;
    }
    if (
      isTerminalPhase(state.phase) &&
      !isRecentTerminal(state.phase, state.updatedAt, input.nowMs)
    ) {
      continue;
    }
    const plan = thread.planProgress;
    const progress = plan && plan.totalSteps > 0
      ? Math.max(0, Math.min(1, plan.completedSteps / plan.totalSteps))
      : undefined;
    const startedAt = state.startedAt ?? thread.latestRun?.startedAt ?? undefined;
    const runningDetail = thread.liveHeadline ?? plan?.step ?? state.detail;
    rows.push({
      environmentId: state.environmentId,
      threadId: state.threadId,
      projectTitle: state.projectTitle,
      threadTitle: state.threadTitle,
      modelTitle: state.modelTitle,
      phase: state.phase,
      status:
        state.phase === "running" && runningDetail ? runningDetail : statusForPhase(state.phase),
      updatedAt: state.updatedAt,
      deepLink: state.deepLink,
      ...(progress === undefined ? {} : { progress }),
      ...(startedAt === undefined ? {} : { startedAt }),
    });
  }

  const activeRows = rows.filter((row) => isActivePhase(row.phase));
  const terminalRows = rows
    .filter((row) => isRecentTerminal(row.phase, row.updatedAt, input.nowMs))
    .sort((a, b) => compareTimestamps(b.updatedAt, a.updatedAt));

  if (activeRows.length === 0) {
    const newest = terminalRows[0];
    if (!newest) {
      return null;
    }
    const failed = terminalRows.some((row) => row.phase === "failed");
    return {
      title: "T3 Pretty",
      subtitle: failed ? "Agent work failed" : "Agent work completed",
      activeCount: 0,
      updatedAt: newest.updatedAt,
      activities: terminalRows.slice(0, MAX_ACTIVITY_ROWS),
    };
  }

  const displayed = [...activeRows, ...terminalRows].slice(0, MAX_ACTIVITY_ROWS);
  const updatedAt = displayed.reduce(
    (latest, row) => (compareTimestamps(row.updatedAt, latest) > 0 ? row.updatedAt : latest),
    displayed[0]?.updatedAt ?? "",
  );
  return {
    title: "T3 Pretty",
    subtitle: "Agent work in progress",
    activeCount: activeRows.length,
    updatedAt,
    activities: displayed,
  };
}
