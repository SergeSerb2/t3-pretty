import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  HomeSuggestionId,
  ProjectId,
  ProviderInstanceId,
  TextGenerationError,
  ThreadId,
  type HomeSuggestion,
  type HomeSuggestionsDigest,
  type HomeSuggestionsSnapshot,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ServerSettings,
} from "@t3tools/contracts";
import type {
  RelayHomeSuggestionsBatch,
  RelayHomeSuggestionsPublishRequest,
  RelayHomeSuggestionsSyncRequest,
  RelayHomeSuggestionsSyncResponse,
} from "@t3tools/contracts/relay";
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
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerActivation } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  TextGeneration,
  type HomeSuggestionsGenerationInput,
} from "../textGeneration/TextGeneration.ts";
import { HomeSuggestionsMesh } from "./HomeSuggestionsMesh.ts";
import * as HomeSuggestions from "./HomeSuggestionsService.ts";

const NOW = "2026-09-21T12:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-1");
const ENVIRONMENT_ID = EnvironmentId.make("env-laptop");
const DESKTOP_ID = EnvironmentId.make("env-desktop");

const unlinkedMesh: HomeSuggestionsMesh["Service"] = {
  linked: Effect.succeed(false),
  sync: () => Effect.succeedNone,
  publish: () => Effect.succeedNone,
};

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
  readonly projectsRef?: Ref.Ref<ReadonlyArray<OrchestrationProjectShell>>;
  readonly generate?: (
    input: HomeSuggestionsGenerationInput,
  ) => Effect.Effect<{ suggestions: typeof generatedCards }, TextGenerationError>;
  readonly suspended?: boolean;
  readonly mesh?: HomeSuggestionsMesh["Service"];
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
        (options.projectsRef === undefined
          ? Effect.succeed(projects)
          : Ref.get(options.projectsRef)
        ).pipe(
          Effect.map((list) => ({
            snapshotSequence: 1,
            projects: list,
            threads: [thread],
            updatedAt: NOW,
          })),
        ),
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
    Layer.succeed(HomeSuggestionsMesh, options.mesh ?? unlinkedMesh),
    Layer.mock(ServerEnvironment)({
      getEnvironmentId: Effect.succeed(ENVIRONMENT_ID),
      getDescriptor: Effect.succeed({ environmentId: ENVIRONMENT_ID, label: "Laptop" } as never),
    }),
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

const desktopDigest: HomeSuggestionsDigest = {
  environmentId: DESKTOP_ID,
  environmentLabel: "Desktop",
  projects: [
    {
      id: ProjectId.make("engine"),
      title: "Engine",
      folder: "engine",
      lastActiveAt: "2026-09-21T11:00:00.000Z",
    },
  ],
  threads: [
    {
      projectId: ProjectId.make("engine"),
      title: "Profile the GC",
      updatedAt: "2026-09-21T11:00:00.000Z",
      status: "completed",
      asked: "Why is the GC slow?",
      outcome: "Found a leak.",
    },
  ],
};

const sharedCard: HomeSuggestion = {
  id: HomeSuggestionId.make("shared:0"),
  kind: "project",
  projectId: ProjectId.make("engine"),
  environmentId: DESKTOP_ID,
  title: "Fix the GC leak",
  summary: "Found yesterday.",
  prompt: "Fix the leak.",
};

/** An in-memory relay: records every call and answers with `respond`. */
const makeFakeRelay = Effect.fn("makeFakeRelay")(function* (
  respond: (request: RelayHomeSuggestionsSyncRequest) => RelayHomeSuggestionsSyncResponse,
) {
  const syncs = yield* Ref.make<ReadonlyArray<RelayHomeSuggestionsSyncRequest>>([]);
  const publishes = yield* Ref.make<ReadonlyArray<RelayHomeSuggestionsPublishRequest>>([]);
  const mesh: HomeSuggestionsMesh["Service"] = {
    linked: Effect.succeed(true),
    sync: (request) =>
      Ref.update(syncs, (previous) => [...previous, request]).pipe(
        Effect.as(Option.some(respond(request))),
      ),
    publish: (request) =>
      Ref.update(publishes, (previous) => [...previous, request]).pipe(
        Effect.as(
          Option.some<RelayHomeSuggestionsBatch>({
            generatedAt: SHARED_AT,
            generatedByEnvironmentId: ENVIRONMENT_ID,
            suggestions: request.suggestions,
            previousTitles: request.previousTitles,
          }),
        ),
      ),
  };
  return { syncs, publishes, mesh };
});

const SHARED_AT = "2026-09-21T12:00:05.000Z";

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
        assert.isTrue(snapshot.timeZone.length > 0);
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

  it.effect("runs the model in the most recently active project's directory", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const stale: OrchestrationProjectShell = {
          ...project,
          id: ProjectId.make("project-0"),
          title: "Older",
          workspaceRoot: "/workspace/older",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        // Listed first, but the thread activity belongs to `project`.
        const harness = yield* makeHarness(baseDir, { projects: [stale, project] });
        yield* withService(harness, (service) => service.drain);
        const generations = yield* Ref.get(harness.generations);
        assert.strictEqual(generations[0]?.cwd, project.workspaceRoot);
        assert.include(generations[0]?.context, "## P1: T3 Pretty");
        assert.include(generations[0]?.context, "## P2: Older");
      }),
    ),
  );

  it.effect("an empty-project run does not consume the first-start slot", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const projects = yield* Ref.make<ReadonlyArray<OrchestrationProjectShell>>([]);
        const harness = yield* makeHarness(baseDir, { projects: [], projectsRef: projects });
        yield* withService(harness, (service) =>
          Effect.gen(function* () {
            const empty = yield* service.current;
            assert.strictEqual(empty.status, "idle");
            assert.isNull(empty.generatedAt);
            yield* service.refresh;
            yield* service.drain;
            const afterRefresh = yield* service.current;
            assert.strictEqual(afterRefresh.status, "idle");
            assert.isNull(afterRefresh.generatedAt);
            assert.strictEqual((yield* Ref.get(harness.generations)).length, 0);

            yield* Ref.set(projects, [project]);
            yield* service.tickOnce;
            yield* service.drain;
            const ready = yield* service.current;
            assert.strictEqual(ready.status, "ready");
            assert.deepStrictEqual(titles(ready), ["Finish the home screen", "Build a CLI timer"]);
          }),
        );
        assert.strictEqual((yield* Ref.get(harness.generations)).length, 1);
      }),
    ),
  );

  it.effect("an empty-project run keeps the previous batch and does not persist empty", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const projects = yield* Ref.make<ReadonlyArray<OrchestrationProjectShell>>([project]);
        const harness = yield* makeHarness(baseDir, { projectsRef: projects });
        yield* withService(harness, (service) =>
          Effect.gen(function* () {
            const ready = yield* service.current;
            assert.strictEqual(ready.status, "ready");
            const generatedAt = ready.generatedAt;
            yield* Ref.set(projects, []);
            yield* service.refresh;
            yield* service.drain;
            const kept = yield* service.current;
            assert.strictEqual(kept.status, "ready");
            assert.strictEqual(kept.generatedAt, generatedAt);
            assert.isNull(kept.error);
            assert.deepStrictEqual(titles(kept), ["Finish the home screen", "Build a CLI timer"]);
          }),
        );
        assert.strictEqual((yield* Ref.get(harness.generations)).length, 1);

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

  it.effect("a stored batch without lastAttemptAt is not a first-start", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig.pipe(
          Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
          Effect.orDie,
        );
        yield* fs.makeDirectory(config.stateDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(config.stateDir, HomeSuggestions.HOME_SUGGESTIONS_FILE_NAME),
          JSON.stringify({
            generatedAt: NOW,
            suggestions: [
              {
                id: "kept",
                kind: "explore",
                projectId: null,
                title: "Already generated",
                summary: "From an older file.",
                prompt: "Keep going.",
              },
            ],
            previousTitles: ["Already generated"],
          }),
        );
        const harness = yield* makeHarness(baseDir);
        const snapshot = yield* withService(harness, (service) =>
          Effect.gen(function* () {
            yield* service.tickOnce;
            yield* service.drain;
            return yield* service.current;
          }),
        );
        assert.strictEqual(snapshot.status, "ready");
        assert.deepStrictEqual(titles(snapshot), ["Already generated"]);
        assert.strictEqual((yield* Ref.get(harness.generations)).length, 0);
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

  it.effect("a tick or refresh while generating does not start a second batch", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const begun = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<void>();
        const harness = yield* makeHarness(baseDir, {
          generate: () =>
            Deferred.succeed(begun, undefined).pipe(
              Effect.andThen(Deferred.await(gate)),
              Effect.andThen(Effect.succeed({ suggestions: generatedCards })),
            ),
        });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* HomeSuggestions.HomeSuggestionsService;
            yield* service.start();
            yield* Deferred.succeed(harness.activation, undefined);
            yield* Deferred.await(begun);
            const overlapping = yield* service.refresh;
            assert.strictEqual(overlapping.status, "generating");
            yield* Deferred.succeed(gate, undefined);
            yield* service.drain;
          }).pipe(Effect.provide(harness.layer)),
        );
        assert.strictEqual((yield* Ref.get(harness.generations)).length, 1);
      }),
    ),
  );

  it.effect("concurrent refreshes claim only one generation", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        let calls = 0;
        const begun = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<void>();
        const harness = yield* makeHarness(baseDir, {
          generate: () => {
            if (++calls === 1) return Effect.succeed({ suggestions: generatedCards });
            return Deferred.succeed(begun, undefined).pipe(
              Effect.andThen(Deferred.await(gate)),
              Effect.andThen(Effect.succeed({ suggestions: generatedCards })),
            );
          },
        });
        yield* withService(harness, (service) =>
          Effect.gen(function* () {
            assert.strictEqual((yield* Ref.get(harness.generations)).length, 1);
            const claimed = yield* Effect.all([service.refresh, service.refresh], {
              concurrency: "unbounded",
            });
            assert.isTrue(claimed.every((snapshot) => snapshot.status === "generating"));
            yield* Deferred.await(begun);
            const overlapping = yield* service.refresh;
            assert.strictEqual(overlapping.status, "generating");
            yield* Deferred.succeed(gate, undefined);
            yield* service.drain;
          }),
        );
        assert.strictEqual((yield* Ref.get(harness.generations)).length, 2);
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

  it.effect("a failed first batch retries within the hour and the failure survives a restart", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        let calls = 0;
        const flaky = yield* makeHarness(baseDir, {
          generate: () =>
            ++calls === 1
              ? Effect.fail(
                  new TextGenerationError({
                    operation: "generateHomeSuggestions",
                    detail: "quota",
                  }),
                )
              : Effect.succeed({ suggestions: generatedCards }),
        });
        yield* withService(flaky, (service) =>
          Effect.gen(function* () {
            assert.strictEqual((yield* service.current).status, "failed");
            yield* TestClock.adjust("30 minutes");
            yield* service.tickOnce;
            yield* service.drain;
            assert.strictEqual((yield* service.current).status, "failed");
          }),
        );
        assert.strictEqual((yield* Ref.get(flaky.generations)).length, 1);

        const restarted = yield* makeHarness(baseDir);
        const snapshot = yield* withService(restarted, (service) =>
          Effect.gen(function* () {
            const loaded = yield* service.current;
            assert.strictEqual(loaded.status, "failed");
            assert.include(loaded.error ?? "", "quota");
            yield* TestClock.adjust("31 minutes");
            yield* service.tickOnce;
            yield* service.drain;
            return yield* service.current;
          }),
        );
        assert.strictEqual(snapshot.status, "ready");
        assert.strictEqual((yield* Ref.get(restarted.generations)).length, 1);
      }),
    ),
  );

  it.effect("a defect during generation still lands on failed and unblocks refresh", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        let calls = 0;
        const harness = yield* makeHarness(baseDir, {
          generate: () =>
            ++calls === 1
              ? Effect.die(new Error("boom"))
              : Effect.succeed({ suggestions: generatedCards }),
        });
        const snapshot = yield* withService(harness, (service) =>
          Effect.gen(function* () {
            const afterDefect = yield* service.current;
            assert.strictEqual(afterDefect.status, "failed");
            assert.include(afterDefect.error ?? "", "boom");
            yield* service.refresh;
            yield* service.drain;
            return yield* service.current;
          }),
        );
        assert.strictEqual(snapshot.status, "ready");
        assert.deepStrictEqual(titles(snapshot), ["Finish the home screen", "Build a CLI timer"]);
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
  it.effect("the lease holder generates once from every machine's digest and publishes", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const relay = yield* makeFakeRelay((request) => ({
          batch: null,
          lease: request.claim === null ? "none" : "granted",
          digests: request.claim === null ? [] : [desktopDigest],
        }));
        const harness = yield* makeHarness(baseDir, { mesh: relay.mesh });
        const snapshot = yield* withService(harness, (service) =>
          Effect.gen(function* () {
            yield* service.tickOnce;
            yield* service.drain;
            return yield* service.current;
          }),
        );

        const generations = yield* Ref.get(harness.generations);
        assert.strictEqual(generations.length, 1);
        assert.include(generations[0]?.context, "## P1: T3 Pretty (folder: t3-pretty, on Laptop)");
        assert.include(generations[0]?.context, "## P2: Engine (folder: engine, on Desktop)");
        const syncs = yield* Ref.get(relay.syncs);
        assert.strictEqual(syncs[0]?.claim, "scheduled");
        assert.strictEqual(syncs[0]?.digest?.environmentId, ENVIRONMENT_ID);
        const publishes = yield* Ref.get(relay.publishes);
        assert.strictEqual(publishes.length, 1);
        assert.strictEqual(publishes[0]?.suggestions[0]?.environmentId, ENVIRONMENT_ID);
        // The relay's stamp is the batch time every machine agrees on.
        assert.strictEqual(snapshot.generatedAt, SHARED_AT);
        assert.deepStrictEqual(titles(snapshot), ["Finish the home screen", "Build a CLI timer"]);
      }),
    ),
  );

  it.effect("adopts today's shared batch instead of generating, then stays quiet", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const relay = yield* makeFakeRelay(() => ({
          batch: {
            generatedAt: "2026-09-21T09:00:00.000Z",
            generatedByEnvironmentId: DESKTOP_ID,
            suggestions: [sharedCard],
            previousTitles: [sharedCard.title],
          },
          lease: "none",
          digests: [],
        }));
        const harness = yield* makeHarness(baseDir, { mesh: relay.mesh });
        const snapshot = yield* withService(harness, (service) =>
          Effect.gen(function* () {
            yield* service.tickOnce;
            yield* service.drain;
            // A minute later: not due, and the relay poll interval has not passed.
            yield* TestClock.adjust("1 minute");
            yield* service.tickOnce;
            return yield* service.current;
          }),
        );

        assert.strictEqual((yield* Ref.get(harness.generations)).length, 0);
        assert.strictEqual((yield* Ref.get(relay.syncs)).length, 1);
        assert.strictEqual(snapshot.status, "ready");
        assert.deepStrictEqual(titles(snapshot), ["Fix the GC leak"]);
        assert.strictEqual(snapshot.suggestions[0]?.environmentId, DESKTOP_ID);
        assert.isTrue(Date.parse(snapshot.nextRunAt ?? "") > Date.parse(NOW));
      }),
    ),
  );

  it.effect("waits while another machine generates, and refresh says so", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const relay = yield* makeFakeRelay(() => ({ batch: null, lease: "held", digests: [] }));
        const harness = yield* makeHarness(baseDir, { mesh: relay.mesh });
        const refreshed = yield* withService(harness, (service) =>
          Effect.gen(function* () {
            yield* service.tickOnce;
            yield* service.drain;
            return yield* Effect.flip(service.refresh);
          }),
        );

        assert.strictEqual((yield* Ref.get(harness.generations)).length, 0);
        assert.include(refreshed.detail, "Another connected machine");
      }),
    ),
  );

  it.effect("a dismissal reaches the relay", () =>
    run((baseDir) =>
      Effect.gen(function* () {
        const relay = yield* makeFakeRelay(() => ({
          batch: {
            generatedAt: "2026-09-21T09:00:00.000Z",
            generatedByEnvironmentId: DESKTOP_ID,
            suggestions: [sharedCard],
            previousTitles: [],
          },
          lease: "none",
          digests: [],
        }));
        const harness = yield* makeHarness(baseDir, { mesh: relay.mesh });
        yield* withService(harness, (service) =>
          Effect.gen(function* () {
            yield* service.tickOnce;
            yield* service.drain;
            yield* service.dismiss(sharedCard.id);
            yield* service.drain;
          }),
        );

        const syncs = yield* Ref.get(relay.syncs);
        assert.deepStrictEqual(syncs.at(-1)?.dismissedSuggestionIds, [sharedCard.id]);
      }),
    ),
  );
});
