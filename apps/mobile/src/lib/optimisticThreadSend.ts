import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  MessageId,
  ModelSelection,
  OrchestrationMessage,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  SkillId,
  ThreadId,
} from "@t3tools/contracts";

import { scopedThreadKey } from "./scopedEntities";
import type { QueuedThreadMessage } from "../state/thread-outbox-model";

export interface OptimisticStartingThread {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly enabledSkillIds?: ReadonlyArray<SkillId>;
  readonly createdAt: string;
  readonly sendStartedAt: string;
  readonly message: {
    readonly messageId: MessageId;
    readonly text: string;
    readonly createdAt: string;
  };
}

export function optimisticStartingThreadKey(
  thread: Pick<OptimisticStartingThread, "environmentId" | "threadId">,
): string {
  return scopedThreadKey(thread.environmentId, thread.threadId);
}

export function optimisticStartingThreadToShell(
  thread: OptimisticStartingThread,
): EnvironmentThreadShell {
  return {
    environmentId: thread.environmentId,
    id: thread.threadId,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    enabledSkillIds: thread.enabledSkillIds ?? [],
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestTurn: null,
    createdAt: thread.createdAt,
    updatedAt: thread.createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    session: {
      threadId: thread.threadId,
      status: "starting",
      providerName: null,
      providerInstanceId: thread.modelSelection.instanceId,
      runtimeMode: thread.runtimeMode,
      activeTurnId: null,
      lastError: null,
      updatedAt: thread.sendStartedAt,
    },
    latestUserMessageAt: thread.message.createdAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

export function optimisticStartingMessage(thread: OptimisticStartingThread): OrchestrationMessage {
  return {
    id: thread.message.messageId,
    role: "user",
    text: thread.message.text,
    turnId: null,
    streaming: false,
    createdAt: thread.message.createdAt,
    updatedAt: thread.message.createdAt,
  };
}

export function queuedThreadMessageToFeedMessage(
  message: QueuedThreadMessage,
): OrchestrationMessage {
  return {
    id: message.messageId,
    role: "user",
    text: message.text,
    turnId: null,
    streaming: false,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
  };
}

/**
 * Server messages win on id. Local queued / starting messages fill the gap
 * until the projection has the same row.
 */
export function mergeOptimisticThreadMessages(
  serverMessages: ReadonlyArray<OrchestrationMessage> | null,
  queuedMessages: ReadonlyArray<QueuedThreadMessage>,
  startingThread: OptimisticStartingThread | null,
): ReadonlyArray<OrchestrationMessage> {
  const merged: OrchestrationMessage[] = serverMessages === null ? [] : [...serverMessages];
  const seen = new Set(merged.map((message) => String(message.id)));

  const append = (message: OrchestrationMessage) => {
    const id = String(message.id);
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    merged.push(message);
  };

  if (startingThread !== null) {
    append(optimisticStartingMessage(startingThread));
  }
  for (const queued of queuedMessages) {
    append(queuedThreadMessageToFeedMessage(queued));
  }
  return serverMessages === null && merged.length === 0 ? [] : merged;
}

/**
 * Local send clock for the working row. Once a real turn has started, that
 * timestamp owns the row. Until then a starting thread, an in-flight outbox
 * send, or a session still coming up should look like thinking.
 */
export function resolveOptimisticSendStartedAt(input: {
  readonly latestTurnStartedAt: string | null;
  readonly latestTurnCompletedAt: string | null;
  readonly sessionStatus: string | null | undefined;
  readonly sessionUpdatedAt: string | null;
  readonly optimisticSendStartedAt: string | null;
  readonly queuedHeadCreatedAt: string | null;
  readonly isDeliveringQueuedMessage: boolean;
  readonly environmentConnected: boolean;
}): string | null {
  const sessionRunning = input.sessionStatus === "running";
  const sessionStarting = input.sessionStatus === "starting";
  const turnHasStarted = input.latestTurnStartedAt !== null;
  const turnSettled = turnHasStarted && input.latestTurnCompletedAt !== null && !sessionRunning;

  if (turnHasStarted && !turnSettled) {
    return null;
  }
  if (sessionRunning) {
    return null;
  }
  if (input.optimisticSendStartedAt !== null) {
    return input.optimisticSendStartedAt;
  }
  if (input.isDeliveringQueuedMessage) {
    return input.queuedHeadCreatedAt;
  }
  if (input.environmentConnected && input.queuedHeadCreatedAt !== null) {
    return input.queuedHeadCreatedAt;
  }
  if (sessionStarting) {
    return input.sessionUpdatedAt;
  }
  return null;
}

export function mergePresentedThreadShells(
  serverShells: ReadonlyArray<EnvironmentThreadShell>,
  startingThreads: ReadonlyArray<OptimisticStartingThread>,
): ReadonlyArray<EnvironmentThreadShell> {
  if (startingThreads.length === 0) {
    return serverShells;
  }

  const seen = new Set(
    serverShells.map((thread) => scopedThreadKey(thread.environmentId, thread.id)),
  );
  const extras: EnvironmentThreadShell[] = [];
  for (const starting of startingThreads) {
    const key = optimisticStartingThreadKey(starting);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    extras.push(optimisticStartingThreadToShell(starting));
  }
  if (extras.length === 0) {
    return serverShells;
  }
  return extras.concat(serverShells);
}
