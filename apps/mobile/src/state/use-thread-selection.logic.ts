import {
  type EnvironmentId,
  type OrchestrationThread,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

function latestUserMessageAt(thread: OrchestrationThread): OrchestrationThread["updatedAt"] | null {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message?.role === "user") {
      return message.createdAt;
    }
  }

  return null;
}

export function threadDetailToShell(
  environmentId: EnvironmentId,
  thread: OrchestrationThread,
): EnvironmentThreadShell {
  return {
    environmentId,
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    enabledSkillIds: thread.enabledSkillIds,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestTurn: thread.latestTurn,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    settledOverride: thread.settledOverride,
    settledAt: thread.settledAt,
    snoozedUntil: thread.snoozedUntil ?? null,
    snoozedAt: thread.snoozedAt ?? null,
    session: thread.session,
    latestUserMessageAt: latestUserMessageAt(thread),
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
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
  threadDetail: OrchestrationThread | null,
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
