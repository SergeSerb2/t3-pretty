import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type HostPowerSnapshot,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import * as HostPowerMonitor from "../background/HostPowerMonitor.ts";
import * as ServerConfig from "../config.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as HostResources from "../resourceTelemetry/HostResources.ts";
import * as Settings from "../serverSettings.ts";
import * as AgentPerfBenchmark from "./AgentPerfBenchmark.ts";
import { AgentPerfCli, AgentPerfError, parseRunOutput } from "./AgentPerfCli.ts";

const CODEX_ID = ProviderInstanceId.make("codex");

const provider: ServerProvider = {
  instanceId: CODEX_ID,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-15T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

const setup = Effect.fn("AgentPerfBenchmark.test.setup")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const baseDir = yield* fs.makeTempDirectoryScoped();
  const enabledRef = yield* Ref.make(true);
  const busyRef = yield* Ref.make(false);
  const cpuRef = yield* Ref.make(0.05);
  const runCount = yield* Ref.make(0);
  const nextRun = yield* Ref.make<Effect.Effect<number, AgentPerfError>>(Effect.succeed(800));
  const hostPower = yield* HostPowerMonitor.make();

  const dependencies = Layer.mergeAll(
    Layer.succeed(
      AgentPerfCli,
      AgentPerfCli.of({
        run: Ref.update(runCount, (count) => count + 1).pipe(
          Effect.andThen(Ref.get(nextRun)),
          Effect.flatten,
        ),
      }),
    ),
    ServerConfig.layerTest(process.cwd(), baseDir),
    Layer.mock(Settings.ServerSettingsService)({
      getSettings: Ref.get(enabledRef).pipe(
        Effect.map((agentPerfBenchmarks) => ({ ...DEFAULT_SERVER_SETTINGS, agentPerfBenchmarks })),
      ),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([provider]) }),
    Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
      isInstanceBusy: () => Ref.get(busyRef),
    }),
    Layer.succeed(HostPowerMonitor.HostPowerMonitor, hostPower),
    Layer.succeed(
      HostResources.HostResources,
      HostResources.HostResources.of({
        read: Ref.get(cpuRef).pipe(
          Effect.map((cpuUtilization) => ({
            sampledAt: 0,
            cpuUtilization,
            cpuCount: 8,
            availableMemoryBytes: 8,
            totalMemoryBytes: 16,
          })),
        ),
      }),
    ),
  );
  // A second instance stands in for a restarted server reading the same state.
  const start = AgentPerfBenchmark.make().pipe(Effect.provide(dependencies));

  const reportPower = (power: Partial<HostPowerSnapshot>) =>
    Effect.gen(function* () {
      yield* hostPower.report({
        ...(yield* hostPower.snapshot),
        stale: false,
        updatedAt: yield* DateTime.now,
        ...power,
      });
    });

  return {
    service: yield* start,
    start,
    enabledRef,
    busyRef,
    cpuRef,
    nextRun,
    reportPower,
    runs: Ref.get(runCount),
  };
});

/** A run that blocks until interrupted, recording that it was. */
const blockingRun = Effect.fn("AgentPerfBenchmark.test.blockingRun")(function* () {
  const started = yield* Deferred.make<void>();
  const interrupted = yield* Ref.make(false);
  const run = Deferred.succeed(started, undefined).pipe(
    Effect.andThen(Effect.never),
    Effect.onInterrupt(() => Ref.set(interrupted, true)),
  );
  return { run, started: Deferred.await(started), interrupted: Ref.get(interrupted) };
});

const scoped = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) => effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("AgentPerfBenchmark", () => {
  it.effect("measures an idle machine, then waits a week before measuring again", () =>
    scoped(
      Effect.gen(function* () {
        const fixture = yield* setup();

        yield* fixture.service.runPass;
        assert.strictEqual(yield* fixture.runs, 1);
        assert.deepStrictEqual(yield* fixture.service.status, {
          agentMark: 800,
          measuredAt: 0,
          running: false,
          error: null,
        });

        yield* TestClock.adjust(Duration.days(6));
        yield* fixture.service.runPass;
        assert.strictEqual(yield* fixture.runs, 1);

        yield* TestClock.adjust(Duration.days(1));
        yield* fixture.service.runPass;
        assert.strictEqual(yield* fixture.runs, 2);
      }),
    ),
  );

  it.effect("keeps the score across restarts", () =>
    scoped(
      Effect.gen(function* () {
        const fixture = yield* setup();
        yield* fixture.service.runPass;

        const restarted = yield* fixture.start;
        assert.strictEqual((yield* restarted.status)?.agentMark, 800);
        yield* restarted.runPass;
        assert.strictEqual(yield* fixture.runs, 1);
      }),
    ),
  );

  it.effect("does nothing and reports nothing while benchmarks are off", () =>
    scoped(
      Effect.gen(function* () {
        const fixture = yield* setup();
        yield* Ref.set(fixture.enabledRef, false);

        yield* fixture.service.runPass;
        assert.strictEqual(yield* fixture.runs, 0);
        assert.strictEqual(yield* fixture.service.status, null);
      }),
    ),
  );

  it.effect("waits while a turn runs or the CPU is busy", () =>
    scoped(
      Effect.gen(function* () {
        const fixture = yield* setup();

        yield* Ref.set(fixture.busyRef, true);
        yield* fixture.service.runPass;
        yield* Ref.set(fixture.busyRef, false);
        yield* Ref.set(fixture.cpuRef, 0.6);
        yield* fixture.service.runPass;
        assert.strictEqual(yield* fixture.runs, 0);

        yield* Ref.set(fixture.cpuRef, 0.05);
        yield* fixture.service.runPass;
        assert.strictEqual(yield* fixture.runs, 1);
      }),
    ),
  );

  it.effect("waits while the user is at the desktop or it runs on battery", () =>
    scoped(
      Effect.gen(function* () {
        const fixture = yield* setup();

        yield* fixture.reportPower({ idle: "false" });
        yield* fixture.service.runPass;
        yield* fixture.reportPower({ idle: "true", onBattery: "true" });
        yield* fixture.service.runPass;
        assert.strictEqual(yield* fixture.runs, 0);

        yield* fixture.reportPower({ idle: "true", onBattery: "false" });
        yield* fixture.service.runPass;
        assert.strictEqual(yield* fixture.runs, 1);
      }),
    ),
  );

  it.effect("stops a run when a turn starts and keeps the previous score", () =>
    scoped(
      Effect.gen(function* () {
        const fixture = yield* setup();
        yield* fixture.service.runPass;
        yield* TestClock.adjust(Duration.days(7));

        const blocking = yield* blockingRun();
        yield* Ref.set(fixture.nextRun, blocking.run);
        const pass = yield* Effect.forkChild(fixture.service.runPass);
        yield* blocking.started;
        assert.strictEqual((yield* fixture.service.status)?.running, true);

        yield* Ref.set(fixture.busyRef, true);
        yield* TestClock.adjust(Duration.seconds(15));
        yield* Fiber.join(pass);

        assert.isTrue(yield* blocking.interrupted);
        assert.deepStrictEqual(yield* fixture.service.status, {
          agentMark: 800,
          measuredAt: 0,
          running: false,
          error: null,
        });
        // Still due, so the next free moment runs it.
        yield* Ref.set(fixture.busyRef, false);
        yield* Ref.set(fixture.nextRun, Effect.succeed(900));
        yield* fixture.service.runPass;
        assert.strictEqual((yield* fixture.service.status)?.agentMark, 900);
      }),
    ),
  );

  it.effect("stops a run when benchmarks are turned off", () =>
    scoped(
      Effect.gen(function* () {
        const fixture = yield* setup();
        const blocking = yield* blockingRun();
        yield* Ref.set(fixture.nextRun, blocking.run);
        const pass = yield* Effect.forkChild(fixture.service.runPass);
        yield* blocking.started;

        yield* Ref.set(fixture.enabledRef, false);
        yield* TestClock.adjust(Duration.seconds(15));
        yield* Fiber.join(pass);

        assert.isTrue(yield* blocking.interrupted);
      }),
    ),
  );

  it.effect("records a failure, keeps the score, and retries a day later", () =>
    scoped(
      Effect.gen(function* () {
        const fixture = yield* setup();
        yield* fixture.service.runPass;
        yield* TestClock.adjust(Duration.days(7));
        yield* Ref.set(
          fixture.nextRun,
          Effect.fail(new AgentPerfError({ message: "Python 3.8 or newer is not installed." })),
        );

        yield* fixture.service.runPass;
        assert.deepStrictEqual(yield* fixture.service.status, {
          agentMark: 800,
          measuredAt: 0,
          running: false,
          error: "Python 3.8 or newer is not installed.",
        });

        yield* TestClock.adjust(Duration.hours(23));
        yield* fixture.service.runPass;
        assert.strictEqual(yield* fixture.runs, 2);

        yield* Ref.set(fixture.nextRun, Effect.succeed(850));
        yield* TestClock.adjust(Duration.hours(1));
        yield* fixture.service.runPass;
        assert.strictEqual(yield* fixture.runs, 3);
        const status = yield* fixture.service.status;
        assert.strictEqual(status?.agentMark, 850);
        assert.strictEqual(status?.error, null);
      }),
    ),
  );
});

describe("parseRunOutput", () => {
  it("reads AgentMark from a successful summary", () => {
    assert.strictEqual(parseRunOutput(0, '{"command":"run","agentmark":1234.5}\n'), 1234.5);
  });

  it("reports the summary's error, or the exit code when there is none", () => {
    const failed = parseRunOutput(1, '{"ok":false,"error":"no reference found","exit_code":1}');
    assert.instanceOf(failed, AgentPerfError);
    assert.strictEqual((failed as AgentPerfError).message, "Agent Perf failed: no reference found");
    const noScore = parseRunOutput(0, '{"command":"run","agentmark":null}');
    assert.strictEqual(
      (noScore as AgentPerfError).message,
      "Agent Perf exited with code 0 and no score.",
    );
    assert.instanceOf(parseRunOutput(130, "not json"), AgentPerfError);
  });
});
