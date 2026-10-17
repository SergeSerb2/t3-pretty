/**
 * ProviderAutoUpdater - installs newer provider CLI releases on its own.
 *
 * There is no cross-machine coordinator. Every environment checks the same
 * registries (npm, or Homebrew for a brew-owned install) and updates itself,
 * so a user's machines converge on one version without talking to each other.
 *
 * Instances that one update command updates together (two accounts on one
 * CLI) are handled as a group: one attempt, one backoff, and a flag on each.
 * An update waits until no instance that may run those files has a turn: Windows cannot
 * replace an executable a live turn holds open, and a CLI swapped mid-turn can
 * fail to load its own files. Failed attempts back off and start over when a
 * newer release appears, because a new release often fixes the failure. The
 * failed `updateState` is marked `automatic`, so clients keep flagging it
 * until a later attempt succeeds.
 *
 * @module ProviderAutoUpdater
 */
import type {
  ProviderDriverKind,
  ServerProvider,
  ServerProviderUpdateState,
  ServerSettings,
} from "@t3tools/contracts";
import {
  createProviderVersionAdvisory,
  resolveLatestProviderVersion,
  type ProviderMaintenanceCapabilities,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import { forkParked } from "../serverActivation.ts";
import * as Settings from "../serverSettings.ts";
import * as ModelManifest from "./ModelManifest.ts";
import * as ProviderMaintenanceRunner from "./providerMaintenanceRunner.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

/** Lets startup probes settle before the first pass. */
const STARTUP_DELAY = Duration.minutes(1);
const CHECK_INTERVAL = Duration.minutes(15);
/** Wait after consecutive failures of one release; the last delay repeats. */
const RETRY_DELAYS = [Duration.hours(1), Duration.hours(4), Duration.hours(24)] as const;
const RETRY_NOTE = "T3 Code will try again automatically.";

interface FailedAttempt {
  readonly latestVersion: string;
  readonly failures: number;
  readonly retryAtMs: number;
}

/** Instances that one update command updates together, such as two accounts on one CLI. */
interface InstallerGroup {
  readonly key: string;
  readonly driver: ProviderDriverKind;
  readonly capabilities: ProviderMaintenanceCapabilities;
  readonly providers: ReadonlyArray<ServerProvider>;
}

export class ProviderAutoUpdater extends Context.Service<
  ProviderAutoUpdater,
  {
    /** Check every provider instance once and update the outdated, idle ones. */
    readonly runPass: Effect.Effect<void>;
  }
>()("t3/provider/ProviderAutoUpdater") {}

function isBehind(
  provider: ServerProvider,
  latestVersion: string,
  capabilities: ProviderMaintenanceCapabilities,
): boolean {
  return (
    createProviderVersionAdvisory({
      driver: provider.driver,
      currentVersion: provider.version,
      latestVersion,
      maintenanceCapabilities: capabilities,
    }).status === "behind_latest"
  );
}

function isAutomatic(
  settings: Pick<ServerSettings, "autoUpdateProviders" | "enableProviderUpdateChecks">,
): boolean {
  return settings.autoUpdateProviders && settings.enableProviderUpdateChecks;
}

function isEligible(provider: ServerProvider | undefined): provider is ServerProvider {
  return (
    provider !== undefined &&
    provider.enabled &&
    provider.installed &&
    provider.version !== null &&
    provider.updateState?.status !== "queued" &&
    provider.updateState?.status !== "running"
  );
}

/**
 * Identifies the files one update command replaces: it names the resolved
 * executable or the package manager prefix. Null when there is no command.
 */
function installerKey(
  driver: ProviderDriverKind,
  capabilities: ProviderMaintenanceCapabilities,
): string | null {
  const update = capabilities.update;
  return update === null ? null : [driver, update.executable, ...update.args].join("\u0000");
}

function hasAutomaticFailure(provider: ServerProvider): boolean {
  return provider.updateState?.automatic === true && provider.updateState.status !== "succeeded";
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("ProviderAutoUpdater.make")(function* () {
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const runner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const settingsService = yield* Settings.ServerSettingsService;
  const manifestService = yield* ModelManifest.ModelManifest;
  const httpClient = yield* HttpClient.HttpClient;
  const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
  // Keyed by installer, so instances sharing an executable share one backoff.
  const failedAttemptsRef = yield* Ref.make<ReadonlyMap<string, FailedAttempt>>(new Map());
  const passLock = yield* Semaphore.make(1);

  const setFlag = (provider: ServerProvider, state: ServerProviderUpdateState | null) =>
    registry.setProviderMaintenanceActionState({
      instanceId: provider.instanceId,
      action: "update",
      state,
    });

  /** Drop flags whose retry promise no longer holds. */
  const clearFlags = (providers: ReadonlyArray<ServerProvider>) =>
    Effect.forEach(providers.filter(hasAutomaticFailure), (provider) => setFlag(provider, null), {
      discard: true,
    });

  const forgetFailure = (key: string) =>
    Ref.update(failedAttemptsRef, (previous) => {
      if (!previous.has(key)) return previous;
      const next = new Map(previous);
      next.delete(key);
      return next;
    });

  const recordFailure = Effect.fn("ProviderAutoUpdater.recordFailure")(function* (
    key: string,
    latestVersion: string,
  ) {
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    yield* Ref.update(failedAttemptsRef, (previous) => {
      const prior = previous.get(key);
      const failures = prior?.latestVersion === latestVersion ? prior.failures + 1 : 1;
      const delay = RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length) - 1]!;
      return new Map(previous).set(key, {
        latestVersion,
        failures,
        retryAtMs: nowMs + Duration.toMillis(delay),
      });
    });
  });

  /** Group eligible instances by the command that updates them. */
  const groupByInstaller = Effect.fn("ProviderAutoUpdater.groupByInstaller")(function* (
    providers: ReadonlyArray<ServerProvider>,
  ) {
    const groups = new Map<string, InstallerGroup>();
    for (const provider of providers.filter(isEligible)) {
      const capabilities = yield* registry.getProviderMaintenanceCapabilitiesForInstance(
        provider.instanceId,
        provider.driver,
      );
      const key = installerKey(provider.driver, capabilities);
      // Manual-only installs (mise, managed runtimes that ship with T3 Code) have no command.
      if (key === null) continue;
      const group = groups.get(key);
      groups.set(key, {
        key,
        driver: provider.driver,
        capabilities: group?.capabilities ?? capabilities,
        providers: [...(group?.providers ?? []), provider],
      });
    }
    return [...groups.values()];
  });

  /**
   * Whether a turn may be running the executable the group is about to
   * replace. Every instance of the driver counts, eligible or not, unless its
   * installer is known to differ. A disabled instance often has no resolvable
   * installer, so it counts.
   */
  const isGroupBusy = Effect.fn("ProviderAutoUpdater.isGroupBusy")(function* (
    group: InstallerGroup,
  ) {
    for (const provider of yield* registry.getProviders) {
      if (provider.driver !== group.driver) continue;
      if (!(yield* sessions.isInstanceBusy(provider.instanceId))) continue;
      const key = installerKey(
        provider.driver,
        yield* registry.getProviderMaintenanceCapabilitiesForInstance(
          provider.instanceId,
          provider.driver,
        ),
      );
      if (key === null || key === group.key) return true;
    }
    return false;
  });

  const refreshGroup = (group: InstallerGroup) =>
    Effect.forEach(group.providers, (provider) =>
      registry
        .refreshInstance(provider.instanceId)
        .pipe(
          Effect.map((providers) =>
            providers.find((candidate) => candidate.instanceId === provider.instanceId),
          ),
        ),
    ).pipe(Effect.map((providers) => providers.filter(isEligible)));

  const updateGroup = Effect.fn("ProviderAutoUpdater.updateGroup")(function* (
    group: InstallerGroup,
  ) {
    const latestVersion = yield* resolveLatestProviderVersion(group.capabilities, {
      fresh: true,
    }).pipe(
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
    );
    if (latestVersion === null) return;
    const behind = (providers: ReadonlyArray<ServerProvider>) =>
      providers.filter((provider) => isBehind(provider, latestVersion, group.capabilities));
    if (behind(group.providers).length === 0) {
      yield* forgetFailure(group.key);
      return yield* clearFlags(group.providers);
    }
    // A release the manifest marks broken is held back, not failed; the
    // provider card already explains it.
    if (
      ProviderMaintenanceRunner.isBlockedProviderVersion(
        yield* manifestService.current,
        group.driver,
        latestVersion,
      )
    ) {
      yield* forgetFailure(group.key);
      return yield* clearFlags(group.providers);
    }
    const failed = (yield* Ref.get(failedAttemptsRef)).get(group.key);
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    if (failed?.latestVersion === latestVersion && nowMs < failed.retryAtMs) {
      // Probe during backoff, so an upgrade made outside T3 Code drops the
      // flag now rather than at the next retry.
      const refreshed = yield* refreshGroup(group);
      if (behind(refreshed).length === 0) {
        yield* forgetFailure(group.key);
        yield* clearFlags(refreshed);
      }
      return;
    }
    if (yield* isGroupBusy(group)) return;

    // Without a client the listed versions can be stale.
    const refreshed = yield* refreshGroup(group);
    const outdated = behind(refreshed);
    const target = outdated[0];
    if (target === undefined) {
      yield* forgetFailure(group.key);
      return yield* clearFlags(refreshed);
    }
    // A turn may have started while the probes ran.
    if (yield* isGroupBusy(group)) return;

    yield* Effect.logInfo("Updating provider automatically", {
      instanceId: target.instanceId,
      from: target.version,
      to: latestVersion,
    });
    // The runner records every command failure in `updateState`. Its typed
    // errors mean a manual update is already running for this instance, or
    // the install no longer has a one-click update; neither is a failure.
    const result = yield* runner
      .updateProvider({ provider: group.driver, instanceId: target.instanceId })
      .pipe(
        Effect.asSome,
        Effect.catch((error) =>
          Effect.logInfo("Automatic provider update skipped", {
            instanceId: target.instanceId,
            reason: error.reason,
          }).pipe(Effect.as(Option.none())),
        ),
      );
    if (Option.isNone(result)) return;
    const updated = result.value.providers.find(
      (candidate) => candidate.instanceId === target.instanceId,
    );
    const state = updated?.updateState;
    if (state?.status === "succeeded") {
      yield* forgetFailure(group.key);
      // The runner re-probes only the instance it updated.
      const others = refreshed.filter((provider) => provider.instanceId !== target.instanceId);
      yield* clearFlags(yield* refreshGroup({ ...group, providers: others }));
      return;
    }
    yield* recordFailure(group.key, latestVersion);
    if (state === undefined) return;
    const flag: ServerProviderUpdateState = {
      ...state,
      message: [state.message, RETRY_NOTE].filter(Boolean).join(" "),
      automatic: true,
    };
    // Flag each instance the failure leaves behind, so whichever one a client
    // shows for this provider carries it.
    yield* Effect.forEach(outdated, (provider) => setFlag(provider, flag), { discard: true });
  });

  const runPass = passLock.withPermits(1)(
    Effect.gen(function* () {
      const settings = yield* settingsService.getSettings;
      const providers = yield* registry.getProviders;
      if (!isAutomatic(settings)) {
        // Nothing will retry, so no failure may keep promising it will.
        yield* Ref.set(failedAttemptsRef, new Map());
        return yield* clearFlags(providers);
      }
      // A disabled or removed instance leaves every group, so nothing else
      // would ever clear its flag.
      yield* clearFlags(providers.filter((provider) => !provider.enabled || !provider.installed));
      // One group at a time: groups can share a package manager lock.
      for (const group of yield* groupByInstaller(providers)) {
        yield* updateGroup(group).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) =>
              Effect.logWarning("Automatic provider update check failed", {
                driver: group.driver,
                cause,
              }),
          ),
        );
      }
    }).pipe(
      // The loop must outlive a failed pass, but not a shutdown.
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Automatic provider update pass failed", { cause }),
      ),
    ),
  );

  return ProviderAutoUpdater.of({ runPass });
});

/** Runs a pass after startup, on an interval, and whenever the setting changes. */
export const layer = Layer.effect(
  ProviderAutoUpdater,
  Effect.gen(function* () {
    const service = yield* make();
    const settingsService = yield* Settings.ServerSettingsService;
    const wake = yield* Queue.sliding<void>(1);
    const changes = yield* settingsService.subscribeChanges;
    let enabled = yield* settingsService.getSettings.pipe(
      Effect.map(isAutomatic),
      Effect.orElseSucceed(() => false),
    );
    yield* forkParked(
      Stream.runForEach(changes, (settings) => {
        const changed = isAutomatic(settings) !== enabled;
        enabled = isAutomatic(settings);
        return changed ? Queue.offer(wake, undefined).pipe(Effect.asVoid) : Effect.void;
      }),
    );
    yield* forkParked(
      Effect.sleep(STARTUP_DELAY).pipe(
        Effect.andThen(
          Effect.forever(
            service.runPass.pipe(
              Effect.andThen(
                // @effect-diagnostics-next-line raceFirstWithSleepToTimeout:off - races the interval against a settings wake-up, not a timeout
                Effect.raceFirst(Effect.sleep(CHECK_INTERVAL), Queue.take(wake)),
              ),
            ),
          ),
        ),
      ),
    );
    return service;
  }),
);
