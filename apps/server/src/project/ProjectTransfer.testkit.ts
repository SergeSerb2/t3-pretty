import {
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export const TRANSFER_TEST_NOW = "2026-08-28T12:00:00.000Z";

export function transferProjection(
  id = ThreadId.make("source-thread"),
): OrchestrationV2ThreadProjection {
  const now = DateTime.makeUnsafe(TRANSFER_TEST_NOW);
  return {
    thread: {
      id,
      projectId: ProjectId.make("source-project"),
      title: "Aerospace Lingo",
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
      forkedFrom: null,
      createdBy: "user",
      creationSource: "web",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: now,
  };
}

export function transferRun(
  projection: OrchestrationV2ThreadProjection,
  status: OrchestrationV2Run["status"] = "completed",
): OrchestrationV2Run {
  const id = projection.thread.id;
  const now = projection.updatedAt;
  return {
    id: RunId.make(`run:${id}`),
    threadId: id,
    ordinal: 1,
    providerInstanceId: projection.thread.providerInstanceId,
    modelSelection: projection.thread.modelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make(`message:${id}`),
    rootNodeId: NodeId.make(`node:${id}`),
    activeAttemptId: null,
    status,
    requestedAt: now,
    startedAt: now,
    completedAt: status === "completed" ? now : null,
    checkpointId: null,
    contextHandoffId: null,
  };
}
