import { presentThreadShell, type EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  MessageId,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  SkillId,
  ThreadId,
} from "@t3tools/contracts";
import { parseNativeResumeCommand } from "@t3tools/shared/nativeResume";

import * as DateTime from "effect/DateTime";
import { scopedThreadKey } from "./scopedEntities";
import type { QueuedThreadMessage } from "../state/thread-outbox-model";

export interface OptimisticFeedMessage {
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly turnId: null;
  readonly streaming: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

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
  const timestamp = DateTime.makeUnsafe(thread.createdAt);
  return presentThreadShell(thread.environmentId, {
    id: thread.threadId,
    projectId: thread.projectId,
    title: thread.title,
    providerInstanceId: thread.modelSelection.instanceId,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    enabledSkillIds: thread.enabledSkillIds ?? [],
    pullRequests: [],
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    activeProviderThreadId: null,
    lineage: { rootThreadId: thread.threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "mobile",
    latestRunId: null,
    activeRunId: null,
    status: "starting",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: DateTime.makeUnsafe(thread.message.createdAt),
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: timestamp,
    updatedAt: DateTime.makeUnsafe(thread.sendStartedAt),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    storedAt: null,
    deletedAt: null,
  });
}

export function optimisticStartingMessage(thread: OptimisticStartingThread): OptimisticFeedMessage {
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

export function isOptimisticStartingThreadPending(
  thread: OptimisticStartingThread | null,
  sessionStatus: string | null | undefined,
): boolean {
  return !(
    thread === null ||
    (parseNativeResumeCommand(thread.message.text)?._tag === "Resume" &&
      (sessionStatus === "error" || sessionStatus === "ready"))
  );
}

export function queuedThreadMessageToFeedMessage(
  message: QueuedThreadMessage,
): OptimisticFeedMessage {
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
  serverMessages: ReadonlyArray<OptimisticFeedMessage> | null,
  queuedMessages: ReadonlyArray<QueuedThreadMessage>,
  startingThread: OptimisticStartingThread | null,
): ReadonlyArray<OptimisticFeedMessage> {
  const merged: OptimisticFeedMessage[] = serverMessages === null ? [] : [...serverMessages];
  const seen = new Set(merged.map((message) => String(message.id)));

  const append = (message: OptimisticFeedMessage) => {
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
