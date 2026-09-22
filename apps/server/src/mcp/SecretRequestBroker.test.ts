import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  EnvironmentId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderService from "../provider/Services/ProviderService.ts";
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

/** Provider service fake: a real pub/sub so the broker's own events and the test's are observable. */
const makeProviderServiceLayer = Effect.gen(function* () {
  const pubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const service = {
    startSession: () => Effect.die("unused"),
    sendTurn: () => Effect.die("unused"),
    compactThread: () => Effect.die("unused"),
    interruptTurn: () => Effect.die("unused"),
    respondToRequest: () => Effect.die("unused"),
    respondToUserInput: () => Effect.die("unused"),
    stopSession: () => Effect.die("unused"),
    listSessions: () => Effect.succeed([]),
    getCapabilities: () => Effect.die("unused"),
    getInstanceInfo: () =>
      Effect.succeed({
        instanceId: INSTANCE_ID,
        driverKind: ProviderDriverKind.make("codex"),
        displayName: undefined,
        enabled: true,
        continuationIdentity: { driverKind: ProviderDriverKind.make("codex") } as never,
      }),
    assertConversationRollbackSupported: () => Effect.die("unused"),
    rollbackConversation: () => Effect.die("unused"),
    uploadFeedback: () => Effect.die("unused"),
    get streamEvents() {
      return Stream.fromPubSub(pubSub);
    },
    publishRuntimeEvent: (event: ProviderRuntimeEvent) =>
      PubSub.publish(pubSub, event).pipe(Effect.asVoid),
  } satisfies ProviderService.ProviderService["Service"];
  return Layer.succeed(ProviderService.ProviderService, service);
});

const TestLayer = SecretRequestBroker.layer.pipe(
  Layer.provideMerge(Layer.unwrap(makeProviderServiceLayer)),
  // The real settings layer, so redacted neighbours are restored from the secret store.
  Layer.provideMerge(
    ServerSettings.layer.pipe(
      Layer.provide(ServerSecretStore.layer),
      Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
    ),
  ),
  Layer.provideMerge(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: () => Effect.succeed(Option.none()),
    }),
  ),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-secret-request-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

/** Records every runtime event and settles `requested` once the prompt opens. */
const collectEvents = Effect.gen(function* () {
  const providerService = yield* ProviderService.ProviderService;
  const events: ProviderRuntimeEvent[] = [];
  const requested = yield* Deferred.make<ProviderRuntimeEvent>();
  yield* Effect.forkScoped(
    Stream.runForEach(providerService.streamEvents, (event) =>
      Effect.gen(function* () {
        events.push(event);
        if (event.type === "user-input.requested") yield* Deferred.succeed(requested, event);
      }),
    ),
    { startImmediately: true },
  );
  return { events, awaitRequested: Deferred.await(requested) };
});

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
        expect(requested.type).toBe("user-input.requested");
        if (requested.type !== "user-input.requested") return;
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
          requestId: ApprovalRequestId.make(requested.requestId!),
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
        const resolved = events.find((event) => event.type === "user-input.resolved");
        expect(resolved?.requestId).toBe(requested.requestId);
        expect(JSON.stringify(events)).not.toContain("sk-test");
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
          requestId: ApprovalRequestId.make(requested.requestId!),
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
          requestId: ApprovalRequestId.make(requested.requestId!),
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
        const providerService = yield* ProviderService.ProviderService;
        const { awaitRequested } = yield* collectEvents;
        const request = yield* Effect.forkChild(
          broker.request({ scope, name: "STRIPE_KEY", purpose: "Charge cards." }),
        );
        const requested = yield* awaitRequested;
        yield* providerService.publishRuntimeEvent({
          type: "turn.aborted",
          eventId: EventId.make("turn-aborted-1"),
          provider: ProviderDriverKind.make("codex"),
          threadId: THREAD_ID,
          createdAt: new Date().toISOString(),
          payload: { reason: "interrupted" },
        });
        expect(yield* Fiber.join(request)).toEqual({ status: "cancelled", name: "STRIPE_KEY" });

        // A Save that lands after the wait ended must not store the value.
        const late = yield* broker
          .respond({
            threadId: THREAD_ID,
            requestId: ApprovalRequestId.make(requested.requestId!),
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
