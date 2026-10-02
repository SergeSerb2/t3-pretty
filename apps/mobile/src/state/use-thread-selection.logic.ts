import * as DateTime from "effect/DateTime";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { type EnvironmentId, type OrchestrationV2ThreadProjection, type OrchestrationV2ThreadShell, type ScopedThreadRef } from "@t3tools/contracts";
import { presentThreadShell, type EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { deriveThreadActivityRun, deriveLatestThreadRun, deriveThreadRuntime } from "@t3tools/client-runtime/state/thread-execution";

function latestUserMessageAt(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2ThreadShell["latestUserMessageAt"] {
  for (let index = projection.messages.length - 1; index >= 0; index -= 1) {
    const message = projection.messages[index];
    if (message?.role === "user") {
      return message.createdAt;
    }
  }

  return null;
}

/**
 * Builds an optimistic thread shell from the detail projection for the window
 * where the shell list has not materialized the thread yet (e.g. a thread that
 * was just created from this device).
 */
export function threadDetailToShell(
  environmentId: EnvironmentId,
  projection: OrchestrationV2ThreadProjection,
): EnvironmentThreadShell {
  const thread = projection.thread;
  const latestRun = deriveLatestThreadRun(projection);
  const runtime = deriveThreadRuntime(projection);
  const activityRun = deriveThreadActivityRun(projection);
  const run = projection.runs.find((candidate) => candidate.id === latestRun?.runId);
  const pendingBackgroundTasks = derivePendingBackgroundWork({ latestRun: run,
    providerThreads: projection.providerThreads, turnItems: projection.turnItems,
    activeProviderThreadId: thread.activeProviderThreadId, runs: projection.runs,
  });
  const pendingRequest =
    projection.runtimeRequests.find((request) => request.status === "pending") ?? null;
  return presentThreadShell(environmentId, {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    providerInstanceId: thread.providerInstanceId,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    linkedPullRequest: thread.linkedPullRequest ?? null,
    pullRequests: thread.pullRequests,
    branchPullRequest: thread.branchPullRequest ?? null,
    activeProviderThreadId: thread.activeProviderThreadId,
    lineage: thread.lineage,
    forkedFrom: thread.forkedFrom,
    createdBy: thread.createdBy,
    creationSource: thread.creationSource,
    latestRunId: latestRun?.runId ?? null,
    latestRunRequestedAt: latestRun?.requestedAt ? DateTime.makeUnsafe(latestRun.requestedAt) : null,
    latestRunStartedAt: latestRun?.startedAt ? DateTime.makeUnsafe(latestRun.startedAt) : null,
    latestRunCompletedAt: latestRun?.completedAt ? DateTime.makeUnsafe(latestRun.completedAt) : null,
    activeRunId: runtime?.activeRunId ?? null,
    activityRunStartedAt: runtime?.activityStartedAt ? DateTime.makeUnsafe(runtime.activityStartedAt) : null,
    activityRunStatus: activityRun && (activityRun.status === "preparing" || activityRun.status === "starting" ||
      activityRun.status === "running" || activityRun.status === "waiting")
      ? activityRun.status : null,
    lastError: runtime?.lastError ?? null,
    lastErrorClass: runtime?.lastErrorClass ?? null,
    pendingBackgroundTasks,
    status: runtime?.status ?? "idle",
    pendingRuntimeRequest:
      pendingRequest === null
        ? null
        : { id: pendingRequest.id, kind: pendingRequest.kind, createdAt: pendingRequest.createdAt },
    latestVisibleMessage: null,
    latestUserMessageAt: latestUserMessageAt(projection),
    hasActionableProposedPlan: false,
    itemCount: projection.turnItems.length,
    visibleItemCount: projection.visibleTurnItems.length,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    settledOverride: thread.settledOverride,
    settledAt: thread.settledAt,
    unsettledAt: thread.unsettledAt,
    activeOrderKey: thread.activeOrderKey,
    autoSettleDisabledAt: thread.autoSettleDisabledAt,
    pinnedAt: thread.pinnedAt,
    pinOrderKey: thread.pinOrderKey,
    snoozedUntil: thread.snoozedUntil ?? null,
    snoozedAt: thread.snoozedAt ?? null,
    deletedAt: thread.deletedAt,
    scenery: thread.scenery,
    storedAt: thread.storedAt,
    enabledSkillIds: thread.enabledSkillIds,
    subagentPolicy: thread.subagentPolicy,
    automationRun: thread.automationRun,
    liveHeadline: thread.liveHeadline,
    planProgress: thread.planProgress,
    limitRecovery: thread.limitRecovery,
    lastVisitedAt: thread.lastVisitedAt,
    titleRegeneration: thread.titleRegeneration,
  });
}

/**
 * The shell snapshot is authoritative for selection metadata, so the hot
 * per-thread detail stream is only subscribed while the shell cannot identify
 * the thread (cold deep links, not-yet-synced shells). Gating the fallback this
 * way keeps selection consumers from re-rendering at stream rate during active
 * turns.
 */
export function resolveSelectionDetailFallbackRef(
  threadRef: ScopedThreadRef | null,
  threadShell: EnvironmentThreadShell | null,
  hasLocalStartingThread = false,
): ScopedThreadRef | null {
  return threadRef !== null && threadShell === null && !hasLocalStartingThread ? threadRef : null;
}

/**
 * Resolves the selected thread shell: the shell snapshot entry when available,
 * otherwise a local starting overlay, otherwise a shell converted from the
 * detail fallback subscription.
 */
export function resolveSelectedThreadShell(
  threadRef: ScopedThreadRef | null,
  threadShell: EnvironmentThreadShell | null,
  threadDetail: OrchestrationV2ThreadProjection | null,
  localStartingShell: EnvironmentThreadShell | null = null,
): EnvironmentThreadShell | null {
  if (threadShell !== null) {
    return threadShell;
  }
  if (localStartingShell !== null) {
    return localStartingShell;
  }
  if (threadRef === null || threadDetail === null) {
    return null;
  }
  return threadDetailToShell(threadRef.environmentId, threadDetail);
}
