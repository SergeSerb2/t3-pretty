import { EventId, MessageId, NodeId, ProjectId, ProviderInstanceId, RunId, ThreadId, type OrchestrationV2Run } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { emptyProjection } from "../orchestration-v2/ProjectionStore.ts";
export const fixtureThreadId = ThreadId.make("thread:fork-projection");
export const fixtureNow = DateTime.makeUnsafe("2026-10-02T00:00:00Z");
const instanceId = ProviderInstanceId.make("codex");
export function fixtureProjection() {
  return emptyProjection({ id: EventId.make("fork:created"), type: "thread.created", threadId: fixtureThreadId, occurredAt: fixtureNow, payload: {
    id: fixtureThreadId, projectId: ProjectId.make("project:fork"), title: "Fork projection",
    createdBy: "user", creationSource: "web", providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "gpt-5" }, runtimeMode: "full-access", interactionMode: "default",
    branch: null, worktreePath: null, activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: fixtureThreadId }, forkedFrom: null,
    createdAt: fixtureNow, updatedAt: fixtureNow, archivedAt: null, deletedAt: null,
    settledOverride: null, settledAt: null, lastVisitedAt: null,
  }});
}
export function fixtureRun(id: string, ordinal: number, status: OrchestrationV2Run["status"]): OrchestrationV2Run {
  return { id: RunId.make(id), threadId: fixtureThreadId, ordinal, providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "gpt-5" }, providerThreadId: null, userMessageId: MessageId.make(`message:${id}`),
    rootNodeId: NodeId.make(`node:${id}`), activeAttemptId: null, status, requestedAt: fixtureNow,
    startedAt: fixtureNow, completedAt: status === "completed" ? fixtureNow : null, checkpointId: null, contextHandoffId: null,
  };
}
