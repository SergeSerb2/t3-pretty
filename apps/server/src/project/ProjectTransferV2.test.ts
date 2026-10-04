import { describe, expect, it } from "@effect/vitest";
import {
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderSessionId,
  ProviderThreadId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { applyToProjection, emptyProjection } from "../orchestration-v2/ProjectionStore.ts";
import {
  eventsForTransferredProjection,
  remapTransferredProjections,
} from "./ProjectTransferV2.ts";
import { transferProjection, transferRun } from "./ProjectTransfer.testkit.ts";

const targetProjectId = ProjectId.make("destination-project");
const targetThreadId = ThreadId.make("destination-thread");
const importedAt = "2026-09-01T12:00:00.000Z";
const remap = (
  projections: ReadonlyArray<OrchestrationV2ThreadProjection>,
  includesGitMetadata = true,
) =>
  remapTransferredProjections({
    projections,
    projectId: targetProjectId,
    firstThreadId: targetThreadId,
    importedAt,
    workspaceRoot: "/destination/workspace",
    includesGitMetadata,
  });

function historyItem(
  projection: OrchestrationV2ThreadProjection,
  text: string,
): Extract<OrchestrationV2TurnItem, { type: "assistant_message" }> {
  const threadId = projection.thread.id;
  return {
    id: TurnItemId.make(`item:${threadId}`),
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: projection.updatedAt,
    completedAt: projection.updatedAt,
    updatedAt: projection.updatedAt,
    type: "assistant_message",
    messageId: MessageId.make(`message:${threadId}`),
    text,
    streaming: false,
  };
}

describe("V2 project transfer graph", () => {
  it("remaps the selected graph together while preserving content and typed history timestamps", () => {
    const parent = transferProjection();
    const child = transferProjection(ThreadId.make("child-thread"));
    const run = transferRun(parent);
    const rootNodeId = run.rootNodeId!;
    const childNodeId = NodeId.make("child-node");
    const projection: OrchestrationV2ThreadProjection = {
      ...parent,
      runs: [run],
      nodes: [
        {
          id: rootNodeId,
          threadId: parent.thread.id,
          runId: run.id,
          parentNodeId: null,
          rootNodeId,
          kind: "root_turn",
          status: "completed",
          countsForRun: true,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          runtimeRequestId: null,
          checkpointScopeId: null,
          startedAt: parent.updatedAt,
          completedAt: parent.updatedAt,
        },
      ],
      subagents: [
        {
          id: childNodeId,
          threadId: parent.thread.id,
          runId: run.id,
          parentNodeId: rootNodeId,
          origin: "app_owned",
          createdBy: "agent",
          driver: ProviderDriverKind.make("codex"),
          providerInstanceId: parent.thread.providerInstanceId,
          providerThreadId: null,
          childThreadId: child.thread.id,
          nativeTaskRef: null,
          prompt: `Keep this literal ${parent.thread.id}`,
          title: "Child task",
          model: null,
          status: "completed",
          result: "Finished child task",
          startedAt: parent.updatedAt,
          completedAt: parent.updatedAt,
          updatedAt: parent.updatedAt,
        },
      ],
      messages: [
        {
          id: run.userMessageId,
          threadId: parent.thread.id,
          runId: run.id,
          nodeId: rootNodeId,
          role: "user",
          text: `Review ${parent.thread.id}`,
          createdBy: "user",
          creationSource: "web",
          attachments: [],
          streaming: false,
          createdAt: parent.updatedAt,
          updatedAt: parent.updatedAt,
        },
      ],
      turnItems: [historyItem(parent, "History remains visible")],
    };
    const childProjection = {
      ...child,
      thread: {
        ...child.thread,
        lineage: {
          parentThreadId: parent.thread.id,
          relationshipToParent: "subagent" as const,
          rootThreadId: parent.thread.id,
        },
      },
    };
    const [movedParent, movedChild] = remap([projection, childProjection]);
    expect(movedParent!.thread.id).toBe(targetThreadId);
    expect(movedParent!.thread.projectId).toBe(targetProjectId);
    expect(movedParent!.runs[0]!.id).not.toBe(run.id);
    expect(movedParent!.runs[0]!.rootNodeId).toBe(movedParent!.nodes[0]!.id);
    expect(movedParent!.messages[0]!.runId).toBe(movedParent!.runs[0]!.id);
    expect(movedParent!.subagents[0]!.childThreadId).toBe(movedChild!.thread.id);
    expect(movedChild!.thread.lineage.parentThreadId).toBe(targetThreadId);
    expect(movedChild!.thread.lineage.rootThreadId).toBe(targetThreadId);
    expect(movedParent!.messages[0]!.text).toBe(`Review ${parent.thread.id}`);
    expect(movedParent!.subagents[0]!.prompt).toBe(`Keep this literal ${parent.thread.id}`);
    expect(DateTime.formatIso(movedParent!.messages[0]!.createdAt)).toBe(
      DateTime.formatIso(parent.updatedAt),
    );
    expect(DateTime.formatIso(movedParent!.updatedAt)).toBe(importedAt);
    const events = eventsForTransferredProjection(movedParent!);
    const created = events[0]!;
    if (created.type !== "thread.created")
      throw new Error("Import must create its app thread first");
    const restored = events.slice(1).reduce(applyToProjection, emptyProjection(created));
    expect(restored.messages[0]!.text).toBe(`Review ${parent.thread.id}`);
    expect(restored.turnItems[0]!.type).toBe("assistant_message");
    expect(restored.runs[0]!.status).toBe("completed");
  });

  it("detaches foreign provider resume handles and pending runtime requests", () => {
    const source = transferProjection();
    const providerThreadId = ProviderThreadId.make("foreign-provider-thread");
    const providerSessionId = ProviderSessionId.make("foreign-session");
    const nodeId = NodeId.make("approval-node");
    const nativeRef = {
      driver: ProviderDriverKind.make("codex"),
      nativeId: "foreign-native-id",
      strength: "strong" as const,
    };
    const projection: OrchestrationV2ThreadProjection = {
      ...source,
      thread: { ...source.thread, activeProviderThreadId: providerThreadId },
      providerSessions: [
        {
          id: providerSessionId,
          driver: ProviderDriverKind.make("codex"),
          providerInstanceId: source.thread.providerInstanceId,
          status: "ready",
          cwd: "/source/workspace",
          model: "gpt-5.6",
          capabilities: CodexProviderCapabilitiesV2,
          createdAt: source.updatedAt,
          updatedAt: source.updatedAt,
          lastError: null,
        },
      ],
      providerThreads: [
        {
          id: providerThreadId,
          driver: ProviderDriverKind.make("codex"),
          providerInstanceId: source.thread.providerInstanceId,
          providerSessionId,
          appThreadId: source.thread.id,
          ownerNodeId: null,
          nativeThreadRef: nativeRef,
          nativeConversationHeadRef: nativeRef,
          status: "idle",
          firstRunOrdinal: 1,
          lastRunOrdinal: 1,
          handoffIds: [],
          forkedFrom: null,
          createdAt: source.updatedAt,
          updatedAt: source.updatedAt,
        },
      ],
      runtimeRequests: [
        {
          id: RuntimeRequestId.make("foreign-request"),
          nodeId,
          providerTurnId: null,
          nativeRequestRef: nativeRef,
          kind: "user_input",
          status: "pending",
          responseCapability: { type: "live", providerSessionId },
          createdAt: source.updatedAt,
          resolvedAt: null,
        },
      ],
    };
    const [moved] = remap([projection], false);
    expect(moved!.thread.activeProviderThreadId).toBeNull();
    expect(moved!.thread.branch).toBeNull();
    expect(moved!.providerSessions[0]!.status).toBe("stopped");
    expect(moved!.providerSessions[0]!.cwd).toBe("/destination/workspace");
    expect(moved!.providerThreads[0]!.nativeThreadRef).toBeNull();
    expect(moved!.providerThreads[0]!.nativeConversationHeadRef).toBeNull();
    expect(moved!.providerThreads[0]!.providerSessionId).toBeNull();
    expect(moved!.runtimeRequests[0]!.status).toBe("cancelled");
    expect(moved!.runtimeRequests[0]!.responseCapability.type).toBe("not_resumable");
  });

  it("preserves inherited visible history when copying a fork without its ancestor", () => {
    const source = transferProjection(ThreadId.make("fork-thread"));
    const ancestor = transferProjection(ThreadId.make("ancestor-thread"));
    const inherited = historyItem(ancestor, "Inherited ancestor conversation");
    const projection: OrchestrationV2ThreadProjection = {
      ...source,
      thread: {
        ...source.thread,
        lineage: {
          parentThreadId: ancestor.thread.id,
          relationshipToParent: "fork",
          rootThreadId: ancestor.thread.id,
        },
      },
      visibleTurnItems: [
        {
          position: 0,
          visibility: "inherited",
          sourceThreadId: ancestor.thread.id,
          sourceItemId: inherited.id,
          item: inherited,
        },
      ],
    };
    const [moved] = remap([projection]);
    expect(moved!.thread.lineage).toEqual({
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: targetThreadId,
    });
    const history = eventsForTransferredProjection(moved!).filter(
      (event) => event.type === "turn-item.updated",
    );
    expect(
      history.some(
        (event) =>
          event.payload.type === "assistant_message" &&
          event.payload.text === "Inherited ancestor conversation",
      ),
    ).toBe(true);
    expect(history.every((event) => event.payload.threadId === targetThreadId)).toBe(true);
  });
});
