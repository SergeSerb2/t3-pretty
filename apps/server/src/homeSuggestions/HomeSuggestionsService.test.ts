import {
  DEFAULT_SERVER_SETTINGS,
  HomeSuggestionId,
  ProjectId,
  ProviderInstanceId,
  TextGenerationError,
  ThreadId,
  type HomeSuggestionsSnapshot,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ServerSettings,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
import * as ServerConfig from "../config.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerActivation } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  TextGeneration,
  type HomeSuggestionsGenerationInput,
} from "../textGeneration/TextGeneration.ts";
import * as HomeSuggestions from "./HomeSuggestionsService.ts";

const NOW = "2026-09-21T12:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-1");

let uuidCounter = 0;
const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(++uuidCounter & 0xff),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const project: OrchestrationProjectShell = {
  id: PROJECT_ID,
  title: "T3 Pretty",
  workspaceRoot: "/workspace/t3-pretty",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: NOW,
};

const thread: OrchestrationThreadShell = {
  id: ThreadId.make("thread-1"),
  projectId: PROJECT_ID,
  title: "Add a home screen",
  enabledSkillIds: [],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-astra" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: null,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

const generatedCards = [
  {
    kind: "project" as const,
    projectKey: "P1",
    title: "Finish the home screen",
    summary: "Started yesterday.",
    prompt: "Wire the cards.",
  },
  {
    kind: "explore" as const,
    projectKey: "",
    title: "Build a CLI timer",
    summary: "Fun.",
    prompt: "Create ~/src/timer.",
  },
];

interface HarnessOptions {
  readonly settings?: Partial<ServerSettings>;
  readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
  readonly generate?: (
    input: HomeSuggestionsGenerationInput,
  ) => Effect.Effect<{ suggestions: typeof generatedCards }, TextGenerationError>;
  readonly suspended?: boolean;
}

const makeHarness = Effect.fn("makeHarness")(function* (
  baseDir: string,
  options: HarnessOptions = {},
) {
  const activation = yield* Deferred.make<void>();
  const generations = yield* Ref.make<ReadonlyArray<HomeSuggestionsGenerationInput>>([]);
  const projects = options.projects ?? [project];
  const dependencies = Layer.mergeAll(
    ServerConfig.layerTest(process.cwd(), baseDir),
    ServerSettingsService.layerTest(options.settings ?? {}),
    Layer.mock(ProjectionSnapshotQuery)({
      getShellSnapshot: () =>
        Effect.succeed({ snapshotSequence: 1, projects, threads: [thread], updatedAt: NOW }),
      getThreadDetailById: () =>
        Effect.succeed(
          Option.some({
            messages: [
              { role: "user", text: "Build a home screen" },
              { role: "assistant", text: "Done." },
            ],
          } as unknown as OrchestrationThread),
        ),
    }),
    Layer.mock(TextGeneration)({
      generateHomeSuggestions: (input) =>
        Ref.update(generations, (previous) => [...previous, input]).pipe(
          Effect.andThen(
            options.generate
              ? options.generate(input)
              : Effect.succeed({ suggestions: generatedCards }),
          ),
        ),
    }),
    Layer.mock(BackgroundPolicy)({
      snapshot: Effect.succeed({
        hostPower: {
          state: "unknown",
          suspended: options.suspended ?? false,
          source: "unknown",
          updatedAt: DateTime.makeUnsafe(NOW),
        },
        leases: [],
        activeForegroundLeaseCount: 0,
        activeScopeKeys: [],
        shouldRunOpportunisticWork: false,
        updatedAt: DateTime.makeUnsafe(NOW),
      } as never),
    }),
    Layer.succeed(ServerActivation, Deferred.await(activation)),
    Layer.succeed(Crypto.Crypto, testCrypto),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  return {
    activation,
    generations,
    layer: HomeSuggestions.layer.pipe(Layer.provide(dependencies)),
  };
});

type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

/** Runs `body` against a started service; the parked roots unpark once `start()` returned. */
const withService = <A, E>(
  harness: Harness,
  body: (service: HomeSuggestions.HomeSuggestionsService["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const service = yield* HomeSuggestions.HomeSuggestionsService;
    yield* service.start();
    yield* Deferred.succeed(harness.activation, undefined);
    yield* service.drain;
    return yield* body(service);
  }).pipe(Effect.provide(harness.layer));

const run = <A, E>(
  body: (baseDir: string) => Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem | Path.Path>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-home-suggestions-" });
      yield* TestClock.setTime(Date.parse(NOW));
      return yield* body(baseDir);
    }),
  ).pipe(Effect.provide(NodeServices.layer));

const titles = (snapshot: HomeSuggestionsSnapshot) =>
  snapshot.suggestions.map((card) => card.title);

describe("HomeSuggestionsService", () => {
  it.effect("generates the first batch on the first tick and persists it", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const harness = yield* makeHarness(baseDir);
        const snapshot = yield* withService(harness, (service) =>
          Effect.gen(function* () {
            yield* service.tickOnce;
            yield* service.drain;
            return yield* service.current;
          }),
        );
        assert.strictEqual(snapshot.status, "ready");
        assert.strictEqual(snapshot.generatedAt, NOW);
        assert.deepStrictEqual(titles(snapshot), ["Finish the home screen", "Build a CLI timer"]);
        assert.strictEqual(snapshot.suggestions[0]?.projectId, PROJECT_ID);
        assert.strictEqual(snapshot.suggestions[1]?.projectId, null);
        assert.isNotNull(snapshot.nextRunAt);

        const generations = yield* Ref.get(harness.generations);
        assert.strictEqual(generations.length, 1);
        assert.strictEqual(
          generations[0]?.modelSelection.model,
          DEFAULT_SERVER_SETTINGS.homeSuggestionsModelSelection.model,
        );
        assert.include(generations[0]?.context, "## P1: T3 Pretty (folder: t3-pretty)");
        assert.include(generations[0]?.context, "Asked: Build a home screen");

        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig.pipe(
          Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
          Effect.orDie,
        );
        const stored = yield* fs.readFileString(
          path.join(config.stateDir, HomeSuggestions.HOME_SUGGESTIONS_FILE_NAME),
        );
        assert.include(stored, "Finish the home screen");
      }),
    ),
  );

  it.effect("does not generate again before the next scheduled time", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const harness = yield* makeHarness(baseDir);
        yield* withService(harness, (service) =>
          Effect.gen(function* () {
            yield* service.tickOnce;
            yield* service.drain;
            yield* TestClock.adjust("2 hours");
            yield* service.tickOnce;
            yield* service.drain;
          }),
        );
        assert.strictEqual((yield* Ref.get(harness.generations)).length, 1);
      }),
    ),
  );

  it.effect("skips the schedule while suggestions are off and while the host is suspended", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const off = yield* makeHarness(baseDir, { settings: { homeSuggestionsEnabled: false } });
        const offSnapshot = yield* withService(off, (service) =>
          service.tickOnce.pipe(Effect.andThen(service.current)),
        );
        assert.strictEqual(offSnapshot.nextRunAt, null);
        assert.strictEqual((yield* Ref.get(off.generations)).length, 0);
        const refused = yield* withService(off, (service) => Effect.result(service.refresh));
        assert.strictEqual(refused._tag, "Failure");

        const suspended = yield* makeHarness(baseDir, { suspended: true });
        yield* withService(suspended, (service) => service.tickOnce);
        assert.strictEqual((yield* Ref.get(suspended.generations)).length, 0);
      }),
    ),
  );

  it.effect("refresh generates by hand and streams the change", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const harness = yield* makeHarness(baseDir);
        const statuses = yield* withService(harness, (service) =>
          Effect.gen(function* () {
            // Starting a fresh install already produced the first batch.
            assert.strictEqual((yield* Ref.get(harness.generations)).length, 1);
            const collected = yield* Ref.make<ReadonlyArray<HomeSuggestionsSnapshot>>([]);
            yield* Effect.forkScoped(
              Stream.runForEach(service.streamChanges, (snapshot) =>
                Ref.update(collected, (previous) => [...previous, snapshot]),
              ),
              { startImmediately: true },
            );
            const accepted = yield* service.refresh;
            assert.strictEqual(accepted.status, "generating");
            yield* service.drain;
            return (yield* Ref.get(collected)).map((snapshot) => snapshot.status);
          }).pipe(Effect.scoped),
        );
        assert.deepStrictEqual(statuses.slice(-2), ["generating", "ready"]);
        assert.strictEqual((yield* Ref.get(harness.generations)).length, 2);
      }),
    ),
  );

  it.effect("keeps the previous batch when generation fails and retries only next time", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const good = yield* makeHarness(baseDir);
        yield* withService(good, (service) => service.tickOnce.pipe(Effect.andThen(service.drain)));

        const failing = yield* makeHarness(baseDir, {
          generate: () =>
            Effect.fail(
              new TextGenerationError({ operation: "generateHomeSuggestions", detail: "quota" }),
            ),
        });
        const snapshot = yield* withService(failing, (service) =>
          Effect.gen(function* () {
            yield* service.refresh;
            yield* service.drain;
            yield* service.tickOnce;
            yield* service.drain;
            return yield* service.current;
          }),
        );
        assert.strictEqual(snapshot.status, "failed");
        assert.include(snapshot.error ?? "", "quota");
        assert.deepStrictEqual(titles(snapshot), ["Finish the home screen", "Build a CLI timer"]);
        assert.strictEqual((yield* Ref.get(failing.generations)).length, 1);
      }),
    ),
  );

  it.effect("dismiss removes a card, survives a restart, and feeds the avoid-list", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const first = yield* makeHarness(baseDir);
        const dismissed = yield* withService(first, (service) =>
          Effect.gen(function* () {
            yield* service.tickOnce;
            yield* service.drain;
            const current = yield* service.current;
            return yield* service.dismiss(current.suggestions[0]!.id);
          }),
        );
        assert.deepStrictEqual(titles(dismissed), ["Build a CLI timer"]);

        const second = yield* makeHarness(baseDir);
        const restored = yield* withService(second, (service) =>
          Effect.gen(function* () {
            const loaded = yield* service.current;
            yield* service.refresh;
            yield* service.drain;
            return loaded;
          }),
        );
        assert.strictEqual(restored.status, "ready");
        assert.deepStrictEqual(titles(restored), ["Build a CLI timer"]);
        const generations = yield* Ref.get(second.generations);
        assert.deepStrictEqual(generations[0]?.previousTitles, [
          "Finish the home screen",
          "Build a CLI timer",
        ]);
        assert.isFalse(HomeSuggestionId.make("x") === dismissed.suggestions[0]?.id);
      }),
    ),
  );
});
