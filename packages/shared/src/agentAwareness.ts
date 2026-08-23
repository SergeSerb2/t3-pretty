import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";

export type AgentAwarenessPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "stale";

export interface AgentAwarenessState {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: AgentAwarenessPhase;
  readonly headline: string;
  readonly detail?: string;
  readonly modelTitle: string;
  readonly updatedAt: string;
  readonly deepLink: string;
  readonly progress?: number;
  readonly startedAt?: string;
}

export interface ProjectThreadAwarenessInput {
  readonly environmentId: EnvironmentId;
  readonly project: Pick<OrchestrationProjectShell, "title">;
  readonly thread: Pick<
    OrchestrationThreadShell,
    | "id"
    | "title"
    | "modelSelection"
    | "session"
    | "latestTurn"
    | "updatedAt"
    | "latestUserMessageAt"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "backgroundLiveness"
    | "planProgress"
  >;
}

export function buildAgentAwarenessDeepLink(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): string {
  return `/threads/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`;
}

export function projectThreadAwareness(
  input: ProjectThreadAwarenessInput,
): AgentAwarenessState | null {
  const { environmentId, project, thread } = input;
  const phase = resolveThreadAwarenessPhase(thread);
  if (!phase) {
    return null;
  }

  const detail = detailForPhase(phase, thread);
  const progress = progressForPhase(phase, thread);
  const startedAt = startedAtForPhase(phase, thread);
  return {
    environmentId,
    threadId: thread.id,
    projectTitle: project.title,
    threadTitle: thread.title,
    phase,
    headline: headlineForPhase(phase),
    ...(detail === undefined ? {} : { detail }),
    ...(progress === undefined ? {} : { progress }),
    ...(startedAt === undefined ? {} : { startedAt }),
    modelTitle: thread.modelSelection.model,
    updatedAt: thread.updatedAt,
    deepLink: buildAgentAwarenessDeepLink({ environmentId, threadId: thread.id }),
  };
}

function resolveThreadAwarenessPhase(
  thread: ProjectThreadAwarenessInput["thread"],
): AgentAwarenessPhase | null {
  if (thread.hasPendingApprovals) {
    return "waiting_for_approval";
  }
  if (thread.hasPendingUserInput) {
    return "waiting_for_input";
  }
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") {
    return "failed";
  }
  if (thread.session?.status === "starting") {
    return "starting";
  }
  if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
    return "running";
  }
  // Background fleets keep the lock-screen card in motion after the parent
  // turn has settled. Without this they project as completed the moment the
  // session flips to ready/idle.
  if (thread.backgroundLiveness === "working" || thread.backgroundLiveness === "monitoring") {
    return "running";
  }
  if (thread.latestTurn?.state === "completed") {
    return "completed";
  }
  // A turn that finished can still read as "interrupted" here: session
  // teardown settles still-running turns by session status, and that write
  // can race the turn.completed one. completedAt survives the race — a turn
  // that has a completion timestamp finished, whatever the state column says.
  // Without this, quick finish-then-teardown threads resolve to null
  // persistently and get tombstoned instead of published as completed.
  if (thread.latestTurn?.state === "interrupted" && thread.latestTurn.completedAt !== null) {
    return "completed";
  }
  // Threads whose turns never produce a checkpoint (no code changes) have no
  // materialized latestTurn in the shell at all, and the session-set
  // projection clears latest_turn_id the moment the session settles. The
  // session status is then the only surviving completion signal: a live
  // session at "ready"/"idle" with nothing pending and nothing running means
  // the agent finished and is waiting for the next prompt — Done.
  if (thread.session?.status === "ready" || thread.session?.status === "idle") {
    return "completed";
  }
  return null;
}

function headlineForPhase(phase: AgentAwarenessPhase): string {
  switch (phase) {
    case "starting":
      return "Starting agent";
    case "running":
      return "Agent is working";
    case "waiting_for_approval":
      return "Approval needed";
    case "waiting_for_input":
      return "Waiting for input";
    case "completed":
      return "Agent finished";
    case "failed":
      return "Agent failed";
    case "stale":
      return "Update delayed";
  }
}

function progressForPhase(
  phase: AgentAwarenessPhase,
  thread: ProjectThreadAwarenessInput["thread"],
): number | undefined {
  const plan = thread.planProgress;
  if (phase !== "running" || !plan || plan.totalSteps <= 0) {
    return undefined;
  }
  return Math.max(0, Math.min(1, plan.completedSteps / plan.totalSteps));
}

// When the in-flight turn began, feeding the Live Activity's ticking elapsed
// timer. Only the materialized running turn carries a trustworthy start;
// sessions running without one (background fleets, pre-checkpoint turns)
// would pin the timer to a stale prior turn, so they get no startedAt.
// Starting shells have no running turn yet. Pin to the prompt that opened
// this connecting window so later session.updatedAt writes (lifecycle
// heartbeats) do not reset the on-screen elapsed timer. Fall back to the
// session stamp when there is no newer prompt.
function startedAtForPhase(
  phase: AgentAwarenessPhase,
  thread: ProjectThreadAwarenessInput["thread"],
): string | undefined {
  if (phase !== "running" && phase !== "starting") {
    return undefined;
  }
  const turn = thread.latestTurn;
  if (turn?.state === "running") {
    return turn.startedAt ?? turn.requestedAt;
  }
  if (phase === "starting") {
    const messageAt = thread.latestUserMessageAt;
    const priorDone = turn?.completedAt;
    if (messageAt && (priorDone == null || messageAt >= priorDone)) {
      return messageAt;
    }
    return thread.session?.updatedAt;
  }
  return undefined;
}

function detailForPhase(
  phase: AgentAwarenessPhase,
  thread: ProjectThreadAwarenessInput["thread"],
): string | undefined {
  if (phase === "failed") {
    return thread.session?.lastError ?? undefined;
  }
  if (phase === "completed") {
    return "Review the completed task.";
  }
  if (phase === "running") {
    const step = thread.planProgress?.step.trim();
    if (step) {
      return step;
    }
  }
  return undefined;
}
