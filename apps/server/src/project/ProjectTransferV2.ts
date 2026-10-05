// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import {
  EventId,
  OrchestrationV2ThreadProjectionJson,
  type OrchestrationV2ThreadProjection,
  OrchestrationV2DomainEvent,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** Remap the whole selected graph together so sibling and subagent references survive. */
export function remapTransferredProjections(input: {
  readonly projections: ReadonlyArray<OrchestrationV2ThreadProjection>;
  readonly projectId: ProjectId;
  readonly firstThreadId: ThreadId;
  readonly importedAt: string;
  readonly workspaceRoot: string;
  readonly includesGitMetadata: boolean;
}): ReadonlyArray<OrchestrationV2ThreadProjection> {
  const encoded = input.projections.map((projection) =>
    Schema.encodeSync(OrchestrationV2ThreadProjectionJson)(projection),
  );
  const ids = new Map<string, string>();
  const entityCollections = [
    "runs",
    "attempts",
    "nodes",
    "subagents",
    "providerSessions",
    "providerThreads",
    "providerTurns",
    "runtimeRequests",
    "messages",
    "plans",
    "turnItems",
    "checkpointScopes",
    "checkpoints",
    "contextHandoffs",
    "contextTransfers",
  ] as const;
  encoded.forEach((projection, index) => {
    ids.set(projection.thread.id, index === 0 ? input.firstThreadId : NodeCrypto.randomUUID());
    for (const key of entityCollections) {
      for (const entity of projection[key]) {
        if (!ids.has(entity.id)) ids.set(entity.id, NodeCrypto.randomUUID());
      }
    }
    for (const item of projection.visibleTurnItems) {
      if (!ids.has(item.item.id)) ids.set(item.item.id, NodeCrypto.randomUUID());
      if ("messageId" in item.item && !ids.has(item.item.messageId))
        ids.set(item.item.messageId, NodeCrypto.randomUUID());
    }
  });
  const replaceIds = (value: unknown, key = ""): unknown => {
    if (typeof value === "string")
      return /(?:^id$|Ids?$)/u.test(key) ? (ids.get(value) ?? value) : value;
    if (Array.isArray(value)) return value.map((item) => replaceIds(item, key));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, replaceIds(item, name)]),
      );
    }
    return value;
  };
  return encoded.map((projection) => {
    const json = replaceIds(projection) as typeof projection;
    const threadId = json.thread.id;
    const parentIncluded =
      projection.thread.lineage.parentThreadId !== null &&
      ids.has(projection.thread.lineage.parentThreadId);
    const visibleIds = new Set(json.visibleTurnItems.map((row) => row.item.id));
    const inherited = json.visibleTurnItems.filter((row) => row.visibility === "inherited");
    const localItems = [
      ...json.visibleTurnItems.map((row) => ({
        ...row.item,
        threadId,
        ...(row.visibility === "inherited"
          ? {
              runId: null,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              parentItemId: null,
            }
          : {}),
      })),
      ...json.turnItems.filter((item) => !visibleIds.has(item.id)),
    ].map((item, ordinal) => ({ ...item, ordinal }));
    const localMessages = [...json.messages];
    for (const row of inherited) {
      if (row.item.type !== "user_message" && row.item.type !== "assistant_message") continue;
      const messageId = row.item.messageId;
      if (localMessages.some((message) => message.id === messageId)) continue;
      localMessages.push({
        id: row.item.messageId,
        threadId,
        runId: null,
        nodeId: null,
        createdBy: row.item.type === "user_message" ? "user" : "agent",
        creationSource: "server",
        role: row.item.type === "user_message" ? "user" : "assistant",
        text: row.item.text,
        attachments: [],
        streaming: false,
        createdAt: row.item.startedAt ?? row.item.updatedAt,
        updatedAt: row.item.updatedAt,
      });
    }
    return Schema.decodeUnknownSync(OrchestrationV2ThreadProjectionJson)({
      ...json,
      thread: {
        ...json.thread,
        projectId: input.projectId,
        activeProviderThreadId: null,
        branch: input.includesGitMetadata ? json.thread.branch : null,
        worktreePath: null,
        linkedPullRequest: null,
        pullRequests: [],
        branchPullRequest: null,
        forkedFrom: null,
        lineage: parentIncluded
          ? json.thread.lineage
          : { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        updatedAt: input.importedAt,
        archivedAt: null,
        deletedAt: null,
        settledOverride: null,
        settledAt: null,
        unsettledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        storedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        titleRegeneration: null,
        automationRun: null,
      },
      providerSessions: json.providerSessions.map((session) => ({
        ...session,
        status: "stopped",
        cwd: input.workspaceRoot,
      })),
      providerThreads: json.providerThreads.map((thread) => ({
        ...thread,
        status: "closed",
        providerSessionId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        nativeMetadata: null,
        pendingBackgroundTasks: [],
      })),
      runtimeRequests: json.runtimeRequests.map((request) => ({
        ...request,
        status: request.status === "pending" ? "cancelled" : request.status,
        responseCapability: {
          type: "not_resumable",
          reason: "Transferred history cannot resume a session on another environment.",
        },
      })),
      turnItems: localItems.map((item) => ({
        ...item,
        ...("attachments" in item ? { attachments: [] } : {}),
      })),
      visibleTurnItems: localItems.map((item, position) => ({
        position,
        visibility: "local",
        sourceThreadId: threadId,
        sourceItemId: item.id,
        item,
      })),
      messages: localMessages.map((message) => ({ ...message, attachments: [], streaming: false })),
      checkpoints: [],
      checkpointScopes: [],
      updatedAt: input.importedAt,
    });
  });
}

/** Import through the same event fold as ordinary commands; no foreign live session resumes. */
export function eventsForTransferredProjection(
  projection: OrchestrationV2ThreadProjection,
): ReadonlyArray<OrchestrationV2DomainEvent> {
  const base = { threadId: projection.thread.id, occurredAt: projection.updatedAt };
  const event = (type: OrchestrationV2DomainEvent["type"], payload: unknown) =>
    Schema.decodeUnknownSync(OrchestrationV2DomainEvent)({
      ...base,
      id: EventId.make(NodeCrypto.randomUUID()),
      type,
      payload,
    });
  return [
    event("thread.created", projection.thread),
    ...projection.runs.map((value) => event("run.created", value)),
    ...projection.attempts.map((value) => event("run-attempt.created", value)),
    ...projection.nodes.map((value) => event("node.updated", value)),
    ...projection.subagents.map((value) => event("subagent.updated", value)),
    ...projection.providerSessions.map((value) => event("provider-session.attached", value)),
    ...projection.providerThreads.map((value) => event("provider-thread.updated", value)),
    ...projection.providerTurns.map((value) => event("provider-turn.updated", value)),
    ...projection.runtimeRequests.map((value) => event("runtime-request.updated", value)),
    ...projection.messages.map((value) => event("message.updated", value)),
    ...projection.plans.map((value) => event("plan.updated", value)),
    ...projection.turnItems.map((value) => event("turn-item.updated", value)),
    ...projection.contextHandoffs.map((value) => event("context-handoff.updated", value)),
    ...projection.contextTransfers.map((value) => event("context-transfer.created", value)),
  ];
}
