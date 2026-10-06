import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  OrchestrationV2ThreadStreamItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore.ts";
import { CodexProviderCapabilitiesV2 } from "./orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as IdAllocator from "./orchestration-v2/IdAllocator.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./orchestration-v2/ProviderAdapterRegistry.ts";
import type { ProviderAdapterV2Shape } from "./orchestration-v2/ProviderAdapter.ts";
import * as ProviderEventIngestor from "./orchestration-v2/ProviderEventIngestor.ts";
import * as ThreadManagementService from "./orchestration-v2/ThreadManagementService.ts";
import * as ThreadCommandExecutor from "./orchestration-v2/ThreadCommandExecutor.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./orchestration-v2/testkit/ProviderReplayHarness.ts";
import { subscribeOrchestrationV2Thread } from "./ws.ts";

const instanceId = ProviderInstanceId.make("claudeAgent");
const driver = ProviderDriverKind.make("claudeAgent");
const registry = ProviderAdapterRegistry.makeLayer([
  {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
    openSession: () => Effect.die("Native provider is replaced at the event boundary"),
  } as ProviderAdapterV2Shape,
]);
const database = SqlitePersistenceMemory;
const runtime = makeOrchestratorV2ReplayLayerWithRegistry(
  { name: "thread-rpc-reconnect" },
  registry,
  { databaseLayer: database, runEffectWorker: false },
);
const projections = ProjectionStore.layer.pipe(Layer.provide(database));
const ingestor = ProviderEventIngestor.layer.pipe(
  Layer.provide(
    Layer.mergeAll(runtime, projections, IdAllocator.layer, ThreadCommandExecutor.layer),
  ),
);
const testLayer = Layer.mergeAll(
  ThreadCommandExecutor.layer,
  runtime,
  projections,
  ingestor,
  ThreadManagementService.layer.pipe(
    Layer.provide(Layer.mergeAll(runtime, ThreadCommandExecutor.layer)),
  ),
  OrchestrationEventStoreLive.pipe(Layer.provide(database)),
);

it.effect(
  "keeps a new thread transcript across initial snapshot, provider catch-up, reopen and reconnect",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const events = yield* ProviderEventIngestor.ProviderEventIngestorV2;
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:rpc-transcript");
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("rpc:create"),
        threadId,
        projectId: ProjectId.make("project:rpc"),
        title: "Transcript",
        modelSelection: { instanceId, model: "claude-sonnet-4-6" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("rpc:input"),
        threadId,
        messageId: MessageId.make("rpc:user"),
        text: "Explain the result",
        attachments: [],
        dispatchMode: { type: "defer_start" },
        createdBy: "user",
        creationSource: "web",
      });
      const beforeReply = yield* orchestrator.getThreadSnapshot(threadId);
      const initial = yield* subscribeOrchestrationV2Thread({
        threadId,
        acceptBoundedSnapshot: true,
        requestCompletionMarker: true,
      });
      const run = beforeReply.projection.runs[0]!;
      const now = yield* DateTime.now;
      const messageId = MessageId.make("rpc:assistant");
      const identity = {
        threadId,
        providerInstanceId: instanceId,
        providerSessionId: ProviderSessionId.make("rpc:provider"),
        runId: run.id,
      };
      yield* events.ingestNormalized({
        ...identity,
        event: {
          type: "message.updated",
          driver,
          message: {
            id: messageId,
            threadId,
            runId: run.id,
            nodeId: run.rootNodeId,
            role: "assistant",
            text: "The reply is available",
            attachments: [],
            streaming: false,
            createdBy: "agent",
            creationSource: "provider",
            createdAt: now,
            updatedAt: now,
          },
        },
      });
      yield* events.ingestNormalized({
        ...identity,
        event: {
          type: "turn_item.updated",
          driver,
          turnItem: {
            id: TurnItemId.make("rpc:assistant-item"),
            threadId,
            runId: run.id,
            nodeId: run.rootNodeId,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: yield* store.getNextTurnItemOrdinal(threadId),
            type: "assistant_message",
            messageId,
            text: "The reply is available",
            streaming: false,
            status: "completed",
            title: null,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
          },
        },
      });
      // The provider replied after snapshot acquisition but before the client
      // consumed it. The persisted tail must bridge that window.
      const first = yield* Stream.runCollect(initial.pipe(Stream.take(4)));
      assert.deepEqual(
        first.map((item) => item.kind),
        ["snapshot", "synchronized", "event", "event"],
      );
      const firstSnapshot = first[0]!;
      assert.equal(firstSnapshot.kind, "snapshot");
      if (firstSnapshot.kind !== "snapshot") return;
      assert.deepEqual(
        firstSnapshot.projection.visibleTurnItems
          .filter(
            (row) => row.item.type === "user_message" || row.item.type === "assistant_message",
          )
          .map((row) => row.item.type),
        ["user_message"],
      );
      const firstEvents = first.filter((item) => item.kind === "event");
      assert.deepEqual(
        firstEvents.map((item) => item.event.type),
        ["message.updated", "turn-item.updated"],
      );

      const reconnect = yield* subscribeOrchestrationV2Thread({
        threadId,
        afterSequence: beforeReply.snapshotSequence,
        requestCompletionMarker: true,
      });
      const replayed = yield* Stream.runCollect(reconnect.pipe(Stream.take(3)));
      assert.deepEqual(
        replayed.map((item) => item.kind),
        ["event", "event", "synchronized"],
      );
      assert.deepEqual(
        replayed.filter((item) => item.kind === "event").map((item) => item.sequence),
        firstEvents.map((item) => item.sequence),
      );

      yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("rpc:archive"),
        threadId,
      });
      yield* orchestrator.dispatch({
        type: "thread.unarchive",
        commandId: CommandId.make("rpc:reopen"),
        threadId,
      });
      const reopened = yield* subscribeOrchestrationV2Thread({
        threadId,
        acceptBoundedSnapshot: true,
        requestCompletionMarker: true,
      });
      const reopenedItems = yield* Stream.runCollect(reopened.pipe(Stream.take(2)));
      const wire = yield* Schema.encodeEffect(Schema.toCodecJson(OrchestrationV2ThreadStreamItem))(
        reopenedItems[0]!,
      );
      const decoded = yield* Schema.decodeEffect(
        Schema.toCodecJson(OrchestrationV2ThreadStreamItem),
      )(wire);
      assert.equal(decoded.kind, "snapshot");
      if (decoded.kind !== "snapshot") return;
      assert.deepEqual(
        decoded.projection.messages.map((message) => message.text),
        ["Explain the result", "The reply is available"],
      );
      assert.deepEqual(
        decoded.projection.visibleTurnItems
          .filter(
            (row) => row.item.type === "user_message" || row.item.type === "assistant_message",
          )
          .map((row) => row.item.type),
        ["user_message", "assistant_message"],
      );
      assert.isNull(decoded.projection.thread.archivedAt);
    }).pipe(Effect.provide(testLayer)),
);
