import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProviderUpdateError,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  makeProviderMaintenanceCapabilities,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as Settings from "../serverSettings.ts";
import * as ModelManifest from "./ModelManifest.ts";
import * as ProviderAutoUpdater from "./ProviderAutoUpdater.ts";
import * as ProviderMaintenanceRunner from "./providerMaintenanceRunner.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const CODEX = ProviderDriverKind.make("codex");
const CODEX_ID = ProviderInstanceId.make("codex");
const CODEX_WORK_ID = ProviderInstanceId.make("codex_work");

const provider = (instanceId: ProviderInstanceId, version: string): ServerProvider => ({
  instanceId,
  driver: CODEX,
  enabled: true,
  installed: true,
  version,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-15T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
});

const unknownCompatibility: ModelManifest.ModelManifestData = {
  version: 1,
  currentModels: {},
  compatibility: [{ driver: "codex", t3CodeRange: ">=0.0.42", ranges: [] }],
};

interface Fixture {
  readonly instances: ReadonlyArray<ProviderInstanceId>;
  readonly installed?: string;
  readonly latest?: string;
  readonly settings?: Partial<ServerSettings>;
  readonly manifest?: ModelManifest.ModelManifestData;
  readonly disabled?: ReadonlyArray<ProviderInstanceId>;
  /** A probe of any instance starts a turn on this one. */
  readonly turnStartsDuringProbe?: ProviderInstanceId;
  /** Instances installed elsewhere, or with an installer T3 Code cannot resolve. */
  readonly installers?: Partial<Record<ProviderInstanceId, "separate" | "unresolved">>;
}

const npmCapabilities = (prefix: string) =>
  makeProviderMaintenanceCapabilities({
    provider: CODEX,
    packageName: "@openai/codex",
    updateExecutable: "npm",
    updateArgs: ["install", "-g", "--prefix", prefix, "@openai/codex@latest"],
    updateLockKey: `npm-global:${prefix}`,
  });

/**
 * Instances share one executable: `installedRef` is what a probe reads, while
 * the registry lists whatever was last probed for each instance.
 */
const setup = Effect.fn("ProviderAutoUpdater.test.setup")(function* (fixture: Fixture) {
  const installedRef = yield* Ref.make(fixture.installed ?? "1.0.0");
  const latestRef = yield* Ref.make(fixture.latest ?? "1.1.0");
  const providersRef = yield* Ref.make(
    fixture.instances.map((instanceId) => ({
      ...provider(instanceId, fixture.installed ?? "1.0.0"),
      enabled: !fixture.disabled?.includes(instanceId),
    })),
  );
  const busyInstanceRef = yield* Ref.make<ProviderInstanceId | null>(null);
  const outcomeRef = yield* Ref.make<"succeeded" | "failed" | "rejected">("succeeded");
  const manifestRef = yield* Ref.make(fixture.manifest ?? unknownCompatibility);
  const updateCalls = yield* Ref.make<ReadonlyArray<ProviderInstanceId>>([]);

  const probe = (instanceId: ProviderInstanceId) =>
    Ref.update(busyInstanceRef, (busy) => fixture.turnStartsDuringProbe ?? busy).pipe(
      Effect.andThen(Ref.get(installedRef)),
      Effect.flatMap((version) =>
        Ref.updateAndGet(providersRef, (providers) =>
          providers.map((candidate) =>
            candidate.instanceId === instanceId ? { ...candidate, version } : candidate,
          ),
        ),
      ),
    );

  const registry: ProviderRegistry.ProviderRegistry["Service"] = {
    getProviders: Ref.get(providersRef),
    refresh: () => Ref.get(providersRef),
    refreshInstance: probe,
    refreshWorkspaceSnapshot: () => Ref.get(providersRef),
    getProviderMaintenanceCapabilitiesForInstance: (instanceId) => {
      const installer = fixture.installers?.[instanceId];
      return Effect.succeed(
        installer === "unresolved"
          ? makeManualOnlyProviderMaintenanceCapabilities({ provider: CODEX, packageName: null })
          : npmCapabilities(installer === "separate" ? "/opt/other" : "/usr/local"),
      );
    },
    setProviderMaintenanceActionState: ({ instanceId, state }) =>
      Ref.updateAndGet(providersRef, (providers) =>
        providers.map((candidate) => {
          if (candidate.instanceId !== instanceId) return candidate;
          const { updateState: _previous, ...rest } = candidate;
          return state === null ? rest : { ...rest, updateState: state };
        }),
      ),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.succeed(Stream.empty),
  };

  const runner = ProviderMaintenanceRunner.ProviderMaintenanceRunner.of({
    updateProvider: (target) =>
      Effect.gen(function* () {
        const instanceId = typeof target === "string" ? CODEX_ID : (target.instanceId ?? CODEX_ID);
        yield* Ref.update(updateCalls, (calls) => [...calls, instanceId]);
        const outcome = yield* Ref.get(outcomeRef);
        if (outcome === "rejected") {
          return yield* new ServerProviderUpdateError({
            provider: CODEX,
            reason: "An update is already running for this provider.",
          });
        }
        if (outcome === "succeeded") {
          yield* Ref.set(installedRef, yield* Ref.get(latestRef));
          yield* probe(instanceId);
        }
        const providers = yield* registry.setProviderMaintenanceActionState({
          instanceId,
          action: "update",
          state: {
            status: outcome,
            startedAt: null,
            finishedAt: null,
            message:
              outcome === "succeeded" ? "Provider updated." : "Update command exited with code 1.",
            output: null,
          },
        });
        return { providers };
      }),
  });

  const latestVersionClient = HttpClient.make((request) =>
    Ref.get(latestRef).pipe(
      Effect.map((version) =>
        HttpClientResponse.fromWeb(
          request,
          Response.json({ version }, { headers: { "content-type": "application/json" } }),
        ),
      ),
    ),
  );
  const settings: ServerSettings = { ...DEFAULT_SERVER_SETTINGS, ...fixture.settings };

  const updater = yield* ProviderAutoUpdater.make().pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(ProviderRegistry.ProviderRegistry, registry),
        Layer.succeed(ProviderMaintenanceRunner.ProviderMaintenanceRunner, runner),
        Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
          isInstanceBusy: (instanceId) =>
            Ref.get(busyInstanceRef).pipe(Effect.map((busy) => busy === instanceId)),
        }),
        Layer.mock(Settings.ServerSettingsService)({
          getSettings: Effect.succeed(settings),
        }),
        Layer.succeed(ModelManifest.ModelManifest, {
          current: Ref.get(manifestRef),
          refresh: Ref.get(manifestRef),
          forceRefresh: Ref.get(manifestRef),
          refreshInBackground: Effect.void,
        }),
        Layer.succeed(HttpClient.HttpClient, latestVersionClient),
        ProviderLatestVersions.layer,
      ),
    ),
  );

  return {
    updater,
    providersRef,
    installedRef,
    latestRef,
    busyInstanceRef,
    outcomeRef,
    manifestRef,
    updateCalls: Ref.get(updateCalls),
  };
});

describe("ProviderAutoUpdater", () => {
  it.effect("updates an outdated provider once, through the instance that owns it", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ instances: [CODEX_ID, CODEX_WORK_ID] });

      yield* fixture.updater.runPass;

      // The second instance shares the executable, so its refresh finds it current.
      assert.deepStrictEqual(yield* fixture.updateCalls, [CODEX_ID]);
      const versions = (yield* Ref.get(fixture.providersRef)).map((entry) => entry.version);
      assert.deepStrictEqual(versions, ["1.1.0", "1.1.0"]);

      yield* fixture.updater.runPass;
      assert.deepStrictEqual(yield* fixture.updateCalls, [CODEX_ID]);
    }),
  );

  it.effect("tries a shared executable once per pass and flags every instance on failure", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ instances: [CODEX_ID, CODEX_WORK_ID] });
      yield* Ref.set(fixture.outcomeRef, "failed");

      yield* fixture.updater.runPass;

      assert.deepStrictEqual(yield* fixture.updateCalls, [CODEX_ID]);
      const flags = (yield* Ref.get(fixture.providersRef)).map(
        (entry) => entry.updateState?.automatic,
      );
      assert.deepStrictEqual(flags, [true, true]);

      // The instances share one backoff, so neither retries early.
      yield* TestClock.adjust(Duration.minutes(30));
      yield* fixture.updater.runPass;
      assert.deepStrictEqual(yield* fixture.updateCalls, [CODEX_ID]);
    }),
  );

  it.effect("waits while another instance of the same executable runs a turn", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ instances: [CODEX_ID, CODEX_WORK_ID] });
      yield* Ref.set(fixture.busyInstanceRef, CODEX_WORK_ID);

      yield* fixture.updater.runPass;

      assert.deepStrictEqual(yield* fixture.updateCalls, []);
    }),
  );

  it.effect("waits while a disabled instance of the same provider runs a turn", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({
        instances: [CODEX_ID, CODEX_WORK_ID],
        disabled: [CODEX_WORK_ID],
      });
      yield* Ref.set(fixture.busyInstanceRef, CODEX_WORK_ID);

      yield* fixture.updater.runPass;

      assert.deepStrictEqual(yield* fixture.updateCalls, []);
    }),
  );

  it.effect("waits for a busy instance whose installer cannot be resolved", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({
        instances: [CODEX_ID, CODEX_WORK_ID],
        disabled: [CODEX_WORK_ID],
        installers: { [CODEX_WORK_ID]: "unresolved" },
      });
      yield* Ref.set(fixture.busyInstanceRef, CODEX_WORK_ID);

      yield* fixture.updater.runPass;

      assert.deepStrictEqual(yield* fixture.updateCalls, []);
    }),
  );

  it.effect("ignores a turn on an install with a different installer", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({
        instances: [CODEX_ID, CODEX_WORK_ID],
        installers: { [CODEX_WORK_ID]: "separate" },
      });
      yield* Ref.set(fixture.busyInstanceRef, CODEX_WORK_ID);

      yield* fixture.updater.runPass;

      // The separate install waits for its own turn to end.
      assert.deepStrictEqual(yield* fixture.updateCalls, [CODEX_ID]);
    }),
  );

  it.effect("rechecks for a turn that starts while the versions are probed", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({
        instances: [CODEX_ID],
        turnStartsDuringProbe: CODEX_ID,
      });

      yield* fixture.updater.runPass;

      assert.deepStrictEqual(yield* fixture.updateCalls, []);
    }),
  );

  it.effect("waits until no turn is running on the instance", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ instances: [CODEX_ID] });
      yield* Ref.set(fixture.busyInstanceRef, CODEX_ID);

      yield* fixture.updater.runPass;
      assert.deepStrictEqual(yield* fixture.updateCalls, []);

      yield* Ref.set(fixture.busyInstanceRef, null);
      yield* fixture.updater.runPass;
      assert.deepStrictEqual(yield* fixture.updateCalls, [CODEX_ID]);
    }),
  );

  it.effect.each([{ autoUpdateProviders: false }, { enableProviderUpdateChecks: false }])(
    "does nothing when turned off (%j)",
    (settings) =>
      Effect.gen(function* () {
        const fixture = yield* setup({ instances: [CODEX_ID], settings });

        yield* fixture.updater.runPass;

        assert.deepStrictEqual(yield* fixture.updateCalls, []);
      }),
  );

  it.effect("holds back a release the manifest marks broken without flagging a failure", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({
        instances: [CODEX_ID],
        manifest: {
          ...unknownCompatibility,
          compatibility: [
            {
              driver: "codex",
              t3CodeRange: ">=0.0.42",
              ranges: [{ range: ">=1.1.0", status: "broken" }],
            },
          ],
        },
      });

      yield* fixture.updater.runPass;

      assert.deepStrictEqual(yield* fixture.updateCalls, []);
      assert.strictEqual((yield* Ref.get(fixture.providersRef))[0]?.updateState, undefined);
    }),
  );

  it.effect("flags a failure, backs off, and retries at once for a newer release", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ instances: [CODEX_ID] });
      yield* Ref.set(fixture.outcomeRef, "failed");

      yield* fixture.updater.runPass;
      const flagged = (yield* Ref.get(fixture.providersRef))[0]?.updateState;
      assert.strictEqual(flagged?.status, "failed");
      assert.strictEqual(
        flagged?.message,
        "Update command exited with code 1. T3 Code will try again automatically.",
      );
      assert.strictEqual(flagged?.automatic, true);

      // The same release waits out the first backoff step.
      yield* TestClock.adjust(Duration.minutes(59));
      yield* fixture.updater.runPass;
      assert.deepStrictEqual(yield* fixture.updateCalls, [CODEX_ID]);

      yield* TestClock.adjust(Duration.minutes(1));
      yield* fixture.updater.runPass;
      assert.deepStrictEqual(yield* fixture.updateCalls, [CODEX_ID, CODEX_ID]);

      // The second failure waits longer, unless a newer release appears.
      yield* TestClock.adjust(Duration.hours(1));
      yield* fixture.updater.runPass;
      assert.strictEqual((yield* fixture.updateCalls).length, 2);

      yield* Ref.set(fixture.latestRef, "1.2.0");
      yield* Ref.set(fixture.outcomeRef, "succeeded");
      yield* fixture.updater.runPass;
      assert.strictEqual((yield* fixture.updateCalls).length, 3);
      assert.strictEqual((yield* Ref.get(fixture.providersRef))[0]?.version, "1.2.0");
    }),
  );

  it.effect("drops the retry flag when the manifest holds the release back", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ instances: [CODEX_ID] });
      yield* Ref.set(fixture.outcomeRef, "failed");
      yield* fixture.updater.runPass;
      assert.strictEqual((yield* Ref.get(fixture.providersRef))[0]?.updateState?.automatic, true);

      yield* Ref.set(fixture.manifestRef, {
        ...unknownCompatibility,
        compatibility: [
          {
            driver: "codex",
            t3CodeRange: ">=0.0.42",
            ranges: [{ range: ">=1.1.0", status: "broken" }],
          },
        ],
      });
      yield* fixture.updater.runPass;

      assert.strictEqual((yield* Ref.get(fixture.providersRef))[0]?.updateState, undefined);
    }),
  );

  it.effect("treats a rejected update as no attempt, without a flag or backoff", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ instances: [CODEX_ID] });
      yield* Ref.set(fixture.outcomeRef, "rejected");

      yield* fixture.updater.runPass;
      assert.strictEqual((yield* Ref.get(fixture.providersRef))[0]?.updateState, undefined);

      yield* Ref.set(fixture.outcomeRef, "succeeded");
      yield* fixture.updater.runPass;
      assert.deepStrictEqual(yield* fixture.updateCalls, [CODEX_ID, CODEX_ID]);
    }),
  );

  it.effect("drops the flag once the provider is current by other means", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ instances: [CODEX_ID] });
      yield* Ref.set(fixture.outcomeRef, "failed");
      yield* fixture.updater.runPass;
      assert.strictEqual((yield* Ref.get(fixture.providersRef))[0]?.updateState?.automatic, true);

      // Updated from a terminal during the backoff; only a probe can see it.
      yield* Ref.set(fixture.installedRef, "1.1.0");
      yield* TestClock.adjust(Duration.minutes(15));
      yield* fixture.updater.runPass;

      assert.deepStrictEqual(yield* fixture.updateCalls, [CODEX_ID]);
      assert.strictEqual((yield* Ref.get(fixture.providersRef))[0]?.updateState, undefined);
    }),
  );

  it.effect("drops the flag of an instance that is later disabled", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({ instances: [CODEX_ID] });
      yield* Ref.set(fixture.outcomeRef, "failed");
      yield* fixture.updater.runPass;
      assert.strictEqual((yield* Ref.get(fixture.providersRef))[0]?.updateState?.automatic, true);

      yield* Ref.update(fixture.providersRef, (providers) =>
        providers.map((entry) => ({ ...entry, enabled: false })),
      );
      yield* fixture.updater.runPass;

      assert.strictEqual((yield* Ref.get(fixture.providersRef))[0]?.updateState, undefined);
    }),
  );

  it.effect("drops automatic failure flags when automatic updates are off", () =>
    Effect.gen(function* () {
      const fixture = yield* setup({
        instances: [CODEX_ID],
        settings: { autoUpdateProviders: false },
      });
      yield* Ref.update(fixture.providersRef, (providers) =>
        providers.map((entry) => ({
          ...entry,
          updateState: {
            status: "failed" as const,
            startedAt: null,
            finishedAt: null,
            message: "Update command exited with code 1. T3 Code will try again automatically.",
            output: null,
            automatic: true,
          },
        })),
      );

      yield* fixture.updater.runPass;

      assert.strictEqual((yield* Ref.get(fixture.providersRef))[0]?.updateState, undefined);
      assert.deepStrictEqual(yield* fixture.updateCalls, []);
    }),
  );
});
