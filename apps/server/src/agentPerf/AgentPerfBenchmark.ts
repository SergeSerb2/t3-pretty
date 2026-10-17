/**
 * AgentPerfBenchmark - keeps this machine's Agent Perf score current.
 *
 * Load balancing favors machines that do local agent work faster. To know
 * which ones those are, each server runs the quick Agent Perf suite about
 * once a week. A run loads every core for several minutes, so it starts only
 * on a quiet machine: no turn running, low CPU, and, where the desktop app
 * reports it, a user away from the keyboard on mains power. It stops as soon
 * as that changes and retries at a later check. A stopped run measured
 * nothing worth keeping, so the previous score stays.
 *
 * @module AgentPerfBenchmark
 */
import {
  HOST_AGENT_PERF_ERROR_MAX_LENGTH,
  type HostAgentPerf,
  type HostPowerSnapshot,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as HostPowerMonitor from "../background/HostPowerMonitor.ts";
import * as ServerConfig from "../config.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as HostResources from "../resourceTelemetry/HostResources.ts";
import { forkParked } from "../serverActivation.ts";
import * as Settings from "../serverSettings.ts";
import { AGENTPERF_VERSION, AgentPerfCli } from "./AgentPerfCli.ts";

/** Startup is when a user is most likely to be working. */
const STARTUP_DELAY = Duration.minutes(10);
const CHECK_INTERVAL = Duration.hours(1);
const RERUN_AFTER = Duration.days(7);
const RETRY_AFTER_FAILURE = Duration.days(1);
/** How often a running benchmark checks that the machine is still free. */
const WATCH_INTERVAL = Duration.seconds(15);
const MAX_IDLE_CPU = 0.25;

const StoredState = Schema.Struct({
  agentMark: Schema.NullOr(Schema.Finite),
  measuredAt: Schema.NullOr(Schema.Finite),
  /** Agent Perf release that measured `agentMark`. A newer pinned release measures again. */
  version: Schema.NullOr(Schema.String),
  failedAt: Schema.NullOr(Schema.Finite),
  error: Schema.NullOr(Schema.String),
});
type StoredState = typeof StoredState.Type;
const StoredStateJson = Schema.fromJsonString(StoredState);
const decodeStoredState = Schema.decodeEffect(StoredStateJson);
const encodeStoredState = Schema.encodeEffect(StoredStateJson);

const EMPTY_STATE: StoredState = {
  agentMark: null,
  measuredAt: null,
  version: null,
  failedAt: null,
  error: null,
};

export class AgentPerfBenchmark extends Context.Service<
  AgentPerfBenchmark,
  {
    /** This machine's benchmark state, or null while benchmarks are off. */
    readonly status: Effect.Effect<HostAgentPerf | null>;
    /** Runs the benchmark when it is due and the machine is free. */
    readonly runPass: Effect.Effect<void>;
  }
>()("t3/agentPerf/AgentPerfBenchmark") {}

export function isBenchmarkDue(state: StoredState, nowMs: number): boolean {
  if (state.failedAt !== null && nowMs - state.failedAt < Duration.toMillis(RETRY_AFTER_FAILURE)) {
    return false;
  }
  return (
    state.measuredAt === null ||
    state.version !== AGENTPERF_VERSION ||
    nowMs - state.measuredAt >= Duration.toMillis(RERUN_AFTER)
  );
}

/** A stale snapshot (no desktop app) says nothing, so it never blocks a run. */
function powerBlocksRun(power: HostPowerSnapshot): boolean {
  return (
    !power.stale &&
    (power.suspended ||
      power.idle === "false" ||
      power.onBattery === "true" ||
      power.lowPowerMode === "true" ||
      power.thermalState === "serious" ||
      power.thermalState === "critical")
  );
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("AgentPerfBenchmark.make")(function* () {
  const cli = yield* AgentPerfCli;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsService = yield* Settings.ServerSettingsService;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const hostPower = yield* HostPowerMonitor.HostPowerMonitor;
  const hostResources = yield* HostResources.HostResources;

  const statePath = path.join(config.stateDir, "agentperf", "state.json");
  const initial = yield* fs.readFileString(statePath).pipe(
    Effect.flatMap(decodeStoredState),
    Effect.orElseSucceed(() => EMPTY_STATE),
  );
  const stateRef = yield* Ref.make(initial);
  const runningRef = yield* Ref.make(false);
  const passLock = yield* Semaphore.make(1);

  const enabled = settingsService.getSettings.pipe(
    Effect.map((settings) => settings.agentPerfBenchmarks),
    Effect.orElseSucceed(() => false),
  );

  const save = Effect.fn("AgentPerfBenchmark.save")(function* (state: StoredState) {
    yield* Ref.set(stateRef, state);
    yield* encodeStoredState(state).pipe(
      Effect.flatMap((contents) => writeFileStringAtomically({ filePath: statePath, contents })),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.ignore({ log: true }),
    );
  });

  /** CPU is checked only before a run: the benchmark itself loads it. */
  const machineBusy = Effect.fn("AgentPerfBenchmark.machineBusy")(function* (checkCpu: boolean) {
    if (!(yield* enabled)) return true;
    for (const provider of yield* registry.getProviders) {
      if (yield* sessions.isInstanceBusy(provider.instanceId)) return true;
    }
    if (powerBlocksRun(yield* hostPower.snapshot)) return true;
    if (!checkCpu) return false;
    const { cpuUtilization } = yield* hostResources.read;
    return cpuUtilization !== null && cpuUtilization >= MAX_IDLE_CPU;
  });

  const waitUntilBusy = Effect.sleep(WATCH_INTERVAL).pipe(
    Effect.andThen(machineBusy(false)),
    Effect.repeat({ until: (busy) => busy }),
  );

  const runPass = passLock.withPermits(1)(
    Effect.gen(function* () {
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      if (!isBenchmarkDue(yield* Ref.get(stateRef), nowMs)) return;
      if (yield* machineBusy(true)) return;

      yield* Effect.logInfo("Running Agent Perf benchmark");
      yield* Ref.set(runningRef, true);
      const outcome = yield* Effect.raceFirst(
        cli.run.pipe(Effect.result),
        waitUntilBusy.pipe(Effect.as(null)),
      ).pipe(Effect.ensuring(Ref.set(runningRef, false)));
      if (outcome === null) {
        return yield* Effect.logInfo("Agent Perf benchmark stopped: the machine is in use");
      }

      const finishedAt = DateTime.toEpochMillis(yield* DateTime.now);
      const state = yield* Ref.get(stateRef);
      if (outcome._tag === "Success") {
        yield* Effect.logInfo("Agent Perf benchmark finished", { agentMark: outcome.success });
        return yield* save({
          agentMark: outcome.success,
          measuredAt: finishedAt,
          version: AGENTPERF_VERSION,
          failedAt: null,
          error: null,
        });
      }
      yield* Effect.logWarning("Agent Perf benchmark failed", { reason: outcome.failure.message });
      yield* save({ ...state, failedAt: finishedAt, error: outcome.failure.message });
    }).pipe(
      // The loop must outlive a failed pass, but not a shutdown.
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("Agent Perf benchmark pass failed", { cause }),
      ),
    ),
  );

  const status = Effect.gen(function* () {
    if (!(yield* enabled)) return null;
    const state = yield* Ref.get(stateRef);
    return {
      agentMark: state.agentMark !== null && state.agentMark > 0 ? state.agentMark : null,
      measuredAt: state.measuredAt === null ? null : Math.max(0, Math.round(state.measuredAt)),
      running: yield* Ref.get(runningRef),
      error: state.error?.slice(0, HOST_AGENT_PERF_ERROR_MAX_LENGTH) ?? null,
    } satisfies HostAgentPerf;
  });

  return AgentPerfBenchmark.of({ status, runPass });
});

/** Checks after startup and then every hour; a run happens only when due. */
export const layer = Layer.effect(
  AgentPerfBenchmark,
  Effect.gen(function* () {
    const service = yield* make();
    yield* forkParked(
      Effect.sleep(STARTUP_DELAY).pipe(
        Effect.andThen(
          Effect.forever(service.runPass.pipe(Effect.andThen(Effect.sleep(CHECK_INTERVAL)))),
        ),
      ),
    );
    return service;
  }),
);
