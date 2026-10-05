import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  RuntimeRequestId,
  EnvironmentId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  MessageId,
  NodeId,
  RunId,
  OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { fixtureProjection } from "../testUtils/V2ProjectionFixture.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as SecretRequestBroker from "./SecretRequestBroker.ts";

const THREAD_ID = ThreadId.make("thread-secret-1");
const INSTANCE_ID = ProviderInstanceId.make("codex");

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: THREAD_ID,
  providerSessionId: "provider-session-1",
  providerInstanceId: INSTANCE_ID,
  capabilities: new Set(["secrets"]),
  issuedAt: 1,
};

const run: OrchestrationV2Run = {
  id: RunId.make("secret-run"), threadId: THREAD_ID, ordinal: 1,
  providerInstanceId: INSTANCE_ID, modelSelection: { instanceId: INSTANCE_ID, model: "gpt-5" },
  providerThreadId: null, userMessageId: MessageId.make("secret-message"),
  rootNodeId: NodeId.make("secret-node"), activeAttemptId: null, status: "running",
  requestedAt: DateTime.makeUnsafe("2026-10-02T00:00:00Z"), startedAt: null, completedAt: null,
  checkpointId: null, contextHandoffId: null,
};
class TestEvents extends Context.Service<TestEvents, {
  readonly stream: Stream.Stream<OrchestrationV2DomainEvent>;
  readonly publish: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
}>()("t3/mcp/SecretRequestBroker.test/TestEvents") {}
const runtimeLayer = Layer.unwrap(Effect.gen(function* () {
  const pubSub = yield* PubSub.unbounded<OrchestrationV2DomainEvent>();
  const stream = Stream.fromPubSub(pubSub);
  const publish = (event: OrchestrationV2DomainEvent) => PubSub.publish(pubSub, event).pipe(Effect.asVoid);
  return Layer.mergeAll(
    Layer.succeed(TestEvents, { stream, publish }),
    Layer.mock(ThreadManagementService)({
      getThreadRecords: () => Effect.succeed({ ...fixtureProjection(), runs: [run], runtimeRequests: [] }),
      streamDomainEvents: stream,
    }),
    Layer.mock(ProjectionStoreV2)({ getNextTurnItemOrdinal: () => Effect.succeed(1) }),
    Layer.mock(EventSinkV2)({ write: ({ events }) => Effect.forEach(events, publish).pipe(Effect.as([])) }),
  );
}));

const TestLayer = SecretRequestBroker.layer.pipe(
  Layer.provideMerge(runtimeLayer),
  // The real settings layer, so redacted neighbours are restored from the secret store.
  Layer.provideMerge(
    ServerSettings.layer.pipe(
      Layer.provide(ServerSecretStore.layer),
      Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
    ),
  ),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-secret-request-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

/** Records every runtime event and settles `requested` once the prompt opens. */
const collectEvents = Effect.gen(function* () {
  const testEvents = yield* TestEvents;
  const events: OrchestrationV2DomainEvent[] = [];
  const requested = yield* Deferred.make<OrchestrationV2DomainEvent>();
  yield* Effect.forkScoped(
    Stream.runForEach(testEvents.stream, (event) =>
      Effect.gen(function* () {
        events.push(event);
        if (event.type === "turn-item.updated" && event.payload.type === "user_input_request" && event.payload.status === "pending") yield* Deferred.succeed(requested, event);
      }),
    ),
    { startImmediately: true },
  );
  return { events, awaitRequested: Deferred.await(requested) };
});

function requestIdOf(event: OrchestrationV2DomainEvent): RuntimeRequestId {
  if (event.type !== "turn-item.updated" || event.payload.type !== "user_input_request") throw new Error("Expected secret prompt");
  return event.payload.requestId;
}

describe("SecretRequestBroker", () => {
  it.effect("opens a masked question, stores the value, and resolves the prompt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const broker = yield* SecretRequestBroker.SecretRequestBroker;
        const serverSettings = yield* ServerSettings.ServerSettingsService;
        const { events, awaitRequested } = yield* collectEvents;

        const request = yield* Effect.forkChild(
          broker.request({ scope, name: "OPENAI_API_KEY", purpose: "Call the OpenAI API." }),
        );
        const requested = yield* awaitRequested;
        expect(requested.type).toBe("turn-item.updated");
        if (requested.type !== "turn-item.updated" || requested.payload.type !== "user_input_request") return;
        expect(requested.payload.questions).toEqual([
          {
            id: "OPENAI_API_KEY",
            header: "API key needed",
            question: "Call the OpenAI API.",
            options: [],
            allowCustomAnswer: true,
            multiSelect: false,
            secret: { name: "OPENAI_API_KEY" },
          },
        ]);

        const reply = yield* broker.respond({
          threadId: THREAD_ID,
          requestId: requestIdOf(requested),
          response: { kind: "provided", value: "sk-test" },
        });
        expect(reply).toEqual({ name: "OPENAI_API_KEY" });

        const outcome = yield* Fiber.join(request);
        expect(outcome.status).toBe("provided");
        if (outcome.status !== "provided") return;
        expect(outcome.secretPath).toContain("global-env-");

        const settings = yield* serverSettings.getSettings;
        expect(settings.globalEnvironment).toEqual([
          { name: "OPENAI_API_KEY", value: "sk-test", sensitive: true, valueRedacted: true },
        ]);
        // The reply itself never becomes an event; only the closing marker does.
        const resolved = events.find((event) => event.type === "runtime-request.updated" && event.payload.status === "resolved");
        expect(resolved?.type === "runtime-request.updated" ? resolved.payload.id : null).toBe(requestIdOf(requested));
        const eventJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.toCodecJson(OrchestrationV2DomainEvent))))(events);
        expect(eventJson).not.toContain("sk-test");
        expect(events.some(event => event.type === "turn-item.updated" && event.payload.type === "user_input_request" && event.payload.status === "completed")).toBe(true);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps other variables and replaces a plain one with the same name", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const broker = yield* SecretRequestBroker.SecretRequestBroker;
        const serverSettings = yield* ServerSettings.ServerSettingsService;
        yield* serverSettings.updateSettings({
          globalEnvironment: [
            { name: "OPENAI_API_KEY", value: "old", sensitive: false },
            { name: "OTHER", value: "keep", sensitive: false },
            { name: "OTHER_SECRET", value: "keep-secret", sensitive: true },
          ],
        });
        const { awaitRequested } = yield* collectEvents;
        const request = yield* Effect.forkChild(
          broker.request({ scope, name: "OPENAI_API_KEY", purpose: "Call the OpenAI API." }),
        );
        const requested = yield* awaitRequested;
        yield* broker.respond({
          threadId: THREAD_ID,
          requestId: requestIdOf(requested),
          response: { kind: "provided", value: "sk-new" },
        });
        yield* Fiber.join(request);
        const settings = yield* serverSettings.getSettings;
        expect(settings.globalEnvironment).toEqual([
          { name: "OTHER", value: "keep", sensitive: false },
          { name: "OTHER_SECRET", value: "keep-secret", sensitive: true, valueRedacted: true },
          { name: "OPENAI_API_KEY", value: "sk-new", sensitive: true, valueRedacted: true },
        ]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("reports a decline without touching settings", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const broker = yield* SecretRequestBroker.SecretRequestBroker;
        const serverSettings = yield* ServerSettings.ServerSettingsService;
        const { awaitRequested } = yield* collectEvents;
        const request = yield* Effect.forkChild(
          broker.request({ scope, name: "STRIPE_KEY", purpose: "Charge cards." }),
        );
        const requested = yield* awaitRequested;
        yield* broker.respond({
          threadId: THREAD_ID,
          requestId: requestIdOf(requested),
          response: { kind: "declined" },
        });
        expect(yield* Fiber.join(request)).toEqual({ status: "declined", name: "STRIPE_KEY" });
        expect((yield* serverSettings.getSettings).globalEnvironment).toEqual([]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("cancels when the turn ends and rejects a later reply", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const broker = yield* SecretRequestBroker.SecretRequestBroker;
        const testEvents = yield* TestEvents;
        const { awaitRequested } = yield* collectEvents;
        const request = yield* Effect.forkChild(
          broker.request({ scope, name: "STRIPE_KEY", purpose: "Charge cards." }),
        );
        const requested = yield* awaitRequested;
        yield* testEvents.publish({
          type: "run.updated", id: EventId.make("secret-run-aborted"), threadId: THREAD_ID,
          occurredAt: yield* DateTime.now, runId: run.id, payload: { ...run, status: "interrupted" },
        });
        expect(yield* Fiber.join(request)).toEqual({ status: "cancelled", name: "STRIPE_KEY" });

        // A Save that lands after the wait ended must not store the value.
        const late = yield* broker
          .respond({
            threadId: THREAD_ID,
            requestId: requestIdOf(requested),
            response: { kind: "provided", value: "sk-late" },
          })
          .pipe(Effect.flip);
        expect(late.reason).toBe("unknown-request");
        const serverSettings = yield* ServerSettings.ServerSettingsService;
        expect((yield* serverSettings.getSettings).globalEnvironment).toEqual([]);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  // Live clock: the broker's timeout must fire on its own.
  it.live("times out when nobody answers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const broker = yield* SecretRequestBroker.SecretRequestBroker;
        const outcome = yield* broker.request({
          scope,
          name: "STRIPE_KEY",
          purpose: "Charge cards.",
          timeoutMs: 1,
        });
        expect(outcome).toEqual({ status: "timed_out", name: "STRIPE_KEY" });
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("allows one open prompt per thread", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const broker = yield* SecretRequestBroker.SecretRequestBroker;
        const { awaitRequested } = yield* collectEvents;
        const first = yield* Effect.forkChild(
          broker.request({ scope, name: "A_KEY", purpose: "First." }),
        );
        yield* awaitRequested;
        const second = yield* broker
          .request({ scope, name: "B_KEY", purpose: "Second." })
          .pipe(Effect.flip);
        expect(second._tag).toBe("SecretRequestPendingError");
        yield* Fiber.interrupt(first);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
