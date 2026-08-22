import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, type EnvironmentId as EnvironmentIdType } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import { PrimaryConnectionTarget, type SupervisorConnectionState } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import {
  environmentRpcKey,
  createAtomCommandScheduler,
  createEnvironmentQueryAtomFamily,
  createRuntimeCommand,
  scheduleAtomCommandEffect,
  executeAtomCommand,
  executeAtomQuery,
  isAtomCauseInterrupted,
  isAtomCommandInterrupted,
  isSettledAtomQueryInterrupt,
  formatAtomQueryError,
  mapAtomCommandResult,
  readAtomQueryResult,
  claimAtomQueryInterruptRetry,
  runAtomCommand,
  settleAsyncResult,
  settlePromise,
  squashAtomCommandFailure,
} from "./runtime.ts";

describe("settleAsyncResult", () => {
  it("preserves successful values and typed failures", async () => {
    const success = await settleAsyncResult(() => Promise.resolve(Exit.succeed("done")));
    expect(AsyncResult.isSuccess(success)).toBe(true);
    if (AsyncResult.isSuccess(success)) {
      expect(success.value).toBe("done");
    }

    const expectedFailure = new Error("request failed");
    const failure = await settleAsyncResult(() => Promise.resolve(Exit.fail(expectedFailure)));
    expect(AsyncResult.isFailure(failure)).toBe(true);
    if (AsyncResult.isFailure(failure)) {
      expect(Cause.hasDies(failure.cause)).toBe(false);
      expect(Cause.squash(failure.cause)).toBe(expectedFailure);
    }
  });

  it("encodes thrown and rejected promises as defects", async () => {
    const thrownDefect = new Error("thrown defect");
    const thrown = await settleAsyncResult<void, never>(() => {
      throw thrownDefect;
    });
    expect(AsyncResult.isFailure(thrown)).toBe(true);
    if (AsyncResult.isFailure(thrown)) {
      expect(Cause.hasDies(thrown.cause)).toBe(true);
      expect(Cause.squash(thrown.cause)).toBe(thrownDefect);
    }

    const rejectedDefect = new Error("rejected defect");
    const rejected = await settleAsyncResult<void, never>(() => Promise.reject(rejectedDefect));
    expect(AsyncResult.isFailure(rejected)).toBe(true);
    if (AsyncResult.isFailure(rejected)) {
      expect(Cause.hasDies(rejected.cause)).toBe(true);
      expect(Cause.squash(rejected.cause)).toBe(rejectedDefect);
    }
  });
});

describe("atom command result helpers", () => {
  it("maps successful command values", () => {
    const result = mapAtomCommandResult(AsyncResult.success(2), (value) => value * 3);

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.value).toBe(6);
    }
  });

  it("preserves failures while mapping", () => {
    const result = mapAtomCommandResult(
      AsyncResult.failure<number, string>(Cause.fail("nope")),
      (value) => value * 3,
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(Cause.squash(result.cause)).toBe("nope");
    }
  });

  it("distinguishes interruption from other failures", () => {
    const interrupted = AsyncResult.failure(Cause.interrupt(1));
    const failed = AsyncResult.failure(Cause.fail("nope"));
    const rewrapped = AsyncResult.failure(
      Cause.fail(new Error("All fibers interrupted without error")),
    );

    expect(isAtomCommandInterrupted(interrupted)).toBe(true);
    expect(isAtomCommandInterrupted(failed)).toBe(false);
    expect(isAtomCauseInterrupted(rewrapped.cause)).toBe(true);
    expect(squashAtomCommandFailure(failed)).toBe("nope");
  });

  it("does not surface a cancelled query as a load error", () => {
    const interrupted = AsyncResult.failure<string, never>(Cause.interrupt(1));
    const rewrapped = AsyncResult.failure<string, Error>(
      Cause.fail(new Error("All fibers interrupted without error")),
    );
    const failed = AsyncResult.failure<string, Error>(
      Cause.fail(new Error("GitHub did not answer.")),
    );
    const previous = AsyncResult.failureWithPrevious<string, never>(Cause.interrupt(1), {
      previous: Option.some(AsyncResult.success("cached")),
    });

    expect(readAtomQueryResult(interrupted)).toEqual({
      data: null,
      error: null,
      isPending: true,
    });
    expect(readAtomQueryResult(rewrapped)).toEqual({
      data: null,
      error: null,
      isPending: true,
    });
    expect(readAtomQueryResult(failed)).toEqual({
      data: null,
      error: "GitHub did not answer.",
      isPending: false,
    });
    expect(readAtomQueryResult(previous)).toEqual({
      data: "cached",
      error: null,
      isPending: false,
    });
    expect(formatAtomQueryError(interrupted.cause)).toBe("The environment request failed.");
    expect(isSettledAtomQueryInterrupt(interrupted)).toBe(true);
    expect(isSettledAtomQueryInterrupt(rewrapped)).toBe(true);
    expect(isSettledAtomQueryInterrupt(failed)).toBe(false);
    expect(isSettledAtomQueryInterrupt(AsyncResult.success("cached"))).toBe(false);
    expect(
      isSettledAtomQueryInterrupt(AsyncResult.failure(Cause.interrupt(1), { waiting: true })),
    ).toBe(false);
  });

  it("claims one interrupt retry per generation", () => {
    const claimed = { current: undefined as unknown };
    expect(claimAtomQueryInterruptRetry(claimed, "list")).toBe(true);
    expect(claimAtomQueryInterruptRetry(claimed, "list")).toBe(false);
    expect(claimAtomQueryInterruptRetry(claimed, "stats")).toBe(true);
    expect(claimAtomQueryInterruptRetry(claimed, "list")).toBe(true);
  });

  it("settles raw promise boundaries as successes or defects", async () => {
    const success = await settlePromise(() => Promise.resolve("done"));
    expect(success._tag).toBe("Success");

    const defect = new Error("raw promise rejected");
    const failure = await settlePromise(() => Promise.reject(defect));
    expect(failure._tag).toBe("Failure");
    if (failure._tag === "Failure") {
      expect(Cause.hasDies(failure.cause)).toBe(true);
      expect(Cause.squash(failure.cause)).toBe(defect);
    }
  });

  it("reports expected failures and defects through separate policies", async () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const reporter = {
      warn: (message: string) => {
        warnings.push(message);
      },
      error: (message: string) => {
        errors.push(message);
      },
    };

    await executeAtomCommand(() => Promise.resolve(Exit.fail("nope")), { label: "save" }, reporter);
    await executeAtomCommand(
      () => Promise.resolve(Exit.fail("ignored")),
      { label: "quiet save", reportFailure: false },
      reporter,
    );
    await executeAtomCommand(
      () => Promise.reject(new Error("defect")),
      { label: "quiet save", reportFailure: false },
      reporter,
    );
    await executeAtomCommand(
      () => Promise.resolve(Exit.interrupt(1)),
      { label: "interrupted" },
      reporter,
    );

    expect(warnings).toEqual(["[atom-command] save failed"]);
    expect(errors).toEqual(["[atom-command] quiet save defected"]);
  });
});

describe("environmentRpcKey", () => {
  it("isolates subscription state by environment and cwd", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const originalTarget = {
      environmentId,
      input: { cwd: "/repo/original" },
    };
    const nextTarget = {
      environmentId,
      input: { cwd: "/repo/next" },
    };

    expect(environmentRpcKey(originalTarget)).not.toBe(environmentRpcKey(nextTarget));
    expect(environmentRpcKey(originalTarget)).toBe(environmentRpcKey({ ...originalTarget }));
    expect(
      environmentRpcKey({
        environmentId: EnvironmentId.make("environment-2"),
        input: originalTarget.input,
      }),
    ).not.toBe(environmentRpcKey(originalTarget));
  });
});

describe("Atom.fn mutation semantics", () => {
  it.effect("interrupts the previous invocation when the same mutation atom is written again", () =>
    Effect.gen(function* () {
      const firstLatch = Latch.makeUnsafe();
      const secondLatch = Latch.makeUnsafe();
      const interrupted: string[] = [];
      const mutation = Atom.fn((id: "first" | "second") =>
        (id === "first" ? firstLatch : secondLatch).await.pipe(
          Effect.as(id),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted.push(id);
            }),
          ),
        ),
      );
      const registry = AtomRegistry.make();
      const unmount = registry.mount(mutation);

      registry.set(mutation, "first");
      registry.set(mutation, "second");
      yield* Effect.yieldNow;

      expect(interrupted).toEqual(["first"]);

      secondLatch.openUnsafe();
      expect(
        yield* AtomRegistry.getResult(registry, mutation, {
          suspendOnWaiting: true,
        }),
      ).toBe("second");

      unmount();
      registry.dispose();
    }),
  );

  it.effect("keeps stream mutations waiting until the final emitted value", () =>
    Effect.gen(function* () {
      const completionLatch = Latch.makeUnsafe();
      const mutation = Atom.fn(() =>
        Stream.make("progress").pipe(
          Stream.concat(Stream.fromEffect(completionLatch.await.pipe(Effect.as("done")))),
        ),
      );
      const registry = AtomRegistry.make();
      const unmount = registry.mount(mutation);

      registry.set(mutation, undefined);

      const progress = registry.get(mutation);
      expect(AsyncResult.isSuccess(progress)).toBe(true);
      if (AsyncResult.isSuccess(progress)) {
        expect(progress.value).toBe("progress");
        expect(progress.waiting).toBe(true);
      }

      completionLatch.openUnsafe();
      expect(
        yield* AtomRegistry.getResult(registry, mutation, {
          suspendOnWaiting: true,
        }),
      ).toBe("done");

      unmount();
      registry.dispose();
    }),
  );

  it.effect(
    "allows concurrent effects to finish but does not correlate results to individual writes",
    () =>
      Effect.gen(function* () {
        const firstLatch = Latch.makeUnsafe();
        const secondLatch = Latch.makeUnsafe();
        const mutation = Atom.fn<never, "first" | "second", "first" | "second">(
          (id: "first" | "second") =>
            (id === "first" ? firstLatch : secondLatch).await.pipe(Effect.as(id)),
          { concurrent: true },
        );
        const registry = AtomRegistry.make();
        const unmount = registry.mount(mutation);

        registry.set(mutation, "first");
        const firstResult = yield* AtomRegistry.getResult(registry, mutation, {
          suspendOnWaiting: true,
        }).pipe(Effect.forkChild({ startImmediately: true }));
        registry.set(mutation, "second");
        const secondResult = yield* AtomRegistry.getResult(registry, mutation, {
          suspendOnWaiting: true,
        }).pipe(Effect.forkChild({ startImmediately: true }));

        secondLatch.openUnsafe();
        yield* Effect.yieldNow;

        const stillWaiting = registry.get(mutation);
        expect(stillWaiting.waiting).toBe(true);

        firstLatch.openUnsafe();

        expect(yield* Fiber.join(firstResult)).toBe("first");
        expect(yield* Fiber.join(secondResult)).toBe("first");

        unmount();
        registry.dispose();
      }),
  );
});

describe("executeAtomQuery", () => {
  it("keeps concurrent query results correlated to their atoms", async () => {
    const firstLatch = Latch.makeUnsafe();
    const secondLatch = Latch.makeUnsafe();
    const firstAtom = Atom.make(firstLatch.await.pipe(Effect.as("first")));
    const secondAtom = Atom.make(secondLatch.await.pipe(Effect.as("second")));
    const registry = AtomRegistry.make();

    const firstResult = executeAtomQuery(registry, firstAtom);
    const secondResult = executeAtomQuery(registry, secondAtom);

    secondLatch.openUnsafe();
    firstLatch.openUnsafe();

    const [first, second] = await Promise.all([firstResult, secondResult]);
    expect(first._tag).toBe("Success");
    expect(second._tag).toBe("Success");
    if (first._tag === "Success" && second._tag === "Success") {
      expect(first.value).toBe("first");
      expect(second.value).toBe("second");
    }

    registry.dispose();
  });
});

describe("runtime command runner", () => {
  it("encodes custom command rejections as defects", async () => {
    const defect = new Error("custom command rejected");
    const registry = AtomRegistry.make();
    const result = await runAtomCommand(
      registry,
      {
        label: "test.rejected-command",
        run: () => Promise.reject(defect),
      },
      undefined,
      { reportDefect: false },
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(Cause.hasDies(result.cause)).toBe(true);
      expect(Cause.squash(result.cause)).toBe(defect);
    }
    registry.dispose();
  });

  it("settles generated command scheduler defects from direct callers", async () => {
    const defect = new Error("invalid command key");
    const runtime = Atom.runtime(Layer.empty);
    const command = createRuntimeCommand(runtime, {
      label: "test.invalid-key",
      concurrency: {
        mode: "serial",
        key: () => {
          throw defect;
        },
      },
      execute: () => Effect.void,
    });
    const registry = AtomRegistry.make();

    const result = await command.run(registry, undefined);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(Cause.hasDies(result.cause)).toBe(true);
      expect(Cause.squash(result.cause)).toBe(defect);
    }
    registry.dispose();
  });

  it("correlates parallel invocation results", async () => {
    const firstLatch = Latch.makeUnsafe();
    const secondLatch = Latch.makeUnsafe();
    const runtime = Atom.runtime(Layer.empty);
    const command = createRuntimeCommand(runtime, {
      label: "test.parallel",
      execute: (id: "first" | "second") =>
        (id === "first" ? firstLatch : secondLatch).await.pipe(Effect.as(id)),
    });
    const registry = AtomRegistry.make();

    const first = command.run(registry, "first");
    const second = command.run(registry, "second");
    secondLatch.openUnsafe();
    firstLatch.openUnsafe();

    expect(await first).toMatchObject({ _tag: "Success", value: "first", waiting: false });
    expect(await second).toMatchObject({ _tag: "Success", value: "second", waiting: false });
    registry.dispose();
  });

  it("serializes commands that share a scheduler and lane", async () => {
    const firstLatch = Latch.makeUnsafe();
    const events: string[] = [];
    const runtime = Atom.runtime(Layer.empty);
    const scheduler = createAtomCommandScheduler();
    const concurrency = { mode: "serial" as const, key: () => "shared" };
    const firstCommand = createRuntimeCommand(runtime, {
      label: "test.first",
      scheduler,
      concurrency,
      execute: () =>
        Effect.sync(() => events.push("first:start")).pipe(
          Effect.andThen(firstLatch.await),
          Effect.tap(() => Effect.sync(() => events.push("first:end"))),
        ),
    });
    const secondCommand = createRuntimeCommand(runtime, {
      label: "test.second",
      scheduler,
      concurrency,
      execute: () => Effect.sync(() => events.push("second:start")),
    });
    const registry = AtomRegistry.make();

    const first = firstCommand.run(registry, undefined);
    const second = secondCommand.run(registry, undefined);
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    firstLatch.openUnsafe();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
    registry.dispose();
  });

  it.effect("releases a shared scheduler lane before the outer command finishes", () =>
    Effect.gen(function* () {
      const handoffStarted = Latch.makeUnsafe();
      const handoffComplete = Latch.makeUnsafe();
      const resumeComplete = Latch.makeUnsafe();
      const runtime = Atom.runtime(Layer.empty);
      const scheduler = createAtomCommandScheduler();
      const concurrency = { mode: "serial" as const, key: () => "shared" };
      const updateCommand = createRuntimeCommand(runtime, {
        label: "test.update",
        execute: (_input: void, registry) =>
          scheduleAtomCommandEffect(
            registry,
            scheduler,
            concurrency,
            undefined,
            Effect.sync(() => handoffStarted.openUnsafe()).pipe(
              Effect.andThen(handoffComplete.await),
            ),
          ).pipe(Effect.andThen(resumeComplete.await)),
      });
      const configCommand = createRuntimeCommand(runtime, {
        label: "test.config",
        scheduler,
        concurrency,
        execute: () => Effect.succeed("configured"),
      });
      const registry = AtomRegistry.make();

      const update = updateCommand.run(registry, undefined);
      yield* handoffStarted.await;
      const config = configCommand.run(registry, undefined);
      handoffComplete.openUnsafe();

      expect(yield* Effect.promise(() => config)).toMatchObject({
        _tag: "Success",
        value: "configured",
        waiting: false,
      });
      resumeComplete.openUnsafe();
      expect(yield* Effect.promise(() => update)).toMatchObject({
        _tag: "Success",
        waiting: false,
      });
      registry.dispose();
    }),
  );

  it("deduplicates single-flight commands by key", async () => {
    const latch = Latch.makeUnsafe();
    let executions = 0;
    const runtime = Atom.runtime(Layer.empty);
    const command = createRuntimeCommand(runtime, {
      label: "test.single-flight",
      concurrency: { mode: "singleFlight", key: (key: string) => key },
      execute: () =>
        Effect.sync(() => executions++).pipe(Effect.andThen(latch.await), Effect.as("done")),
    });
    const registry = AtomRegistry.make();

    const first = command.run(registry, "same");
    const second = command.run(registry, "same");
    latch.openUnsafe();

    expect(await first).toMatchObject({ _tag: "Success", value: "done", waiting: false });
    expect(await second).toMatchObject({ _tag: "Success", value: "done", waiting: false });
    expect(executions).toBe(1);
    registry.dispose();
  });

  it("coalesces pending latest-value commands without interrupting the active call", async () => {
    const firstLatch = Latch.makeUnsafe();
    const executed: number[] = [];
    const runtime = Atom.runtime(Layer.empty);
    const command = createRuntimeCommand(runtime, {
      label: "test.latest",
      concurrency: { mode: "latest", key: () => "shared" },
      execute: (value: number) =>
        Effect.sync(() => executed.push(value)).pipe(
          Effect.andThen(value === 1 ? firstLatch.await : Effect.void),
          Effect.as(value),
        ),
    });
    const registry = AtomRegistry.make();

    const first = command.run(registry, 1);
    await Promise.resolve();
    const second = command.run(registry, 2);
    const third = command.run(registry, 3);
    firstLatch.openUnsafe();

    expect(await first).toMatchObject({ _tag: "Success", value: 1, waiting: false });
    expect(await second).toMatchObject({ _tag: "Success", value: 3, waiting: false });
    expect(await third).toMatchObject({ _tag: "Success", value: 3, waiting: false });
    expect(executed).toEqual([1, 3]);
    registry.dispose();
  });
});

describe("createEnvironmentQueryAtomFamily", () => {
  const TARGET = new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make("environment-1"),
    label: "Test environment",
    httpBaseUrl: "https://environment.example.test",
    wsBaseUrl: "wss://environment.example.test",
  });

  const connectedState = (generation: number): SupervisorConnectionState => ({
    desired: true,
    network: "online",
    phase: "connected",
    stage: null,
    attempt: 1,
    generation,
    lastFailure: null,
    retryAt: null,
  });

  const makeQueryHarness = Effect.fn("TestRuntime.makeQueryHarness")(function* (
    staleTimeMs: number,
  ) {
    const executions = yield* Ref.make(0);
    const state = yield* SubscriptionRef.make<SupervisorConnectionState>(connectedState(1));
    const wakeups = yield* Queue.unbounded<ConnectionWakeups.ConnectionWakeup>();
    // The atom runtime builds its own context, so the test clock is shared by
    // instance rather than by layer.
    const testClock = yield* TestClock.make();
    const supervisor = {
      target: TARGET,
      state,
    } as unknown as EnvironmentSupervisor["Service"];
    const registryStub = {
      run: <A, E, R>(_environmentId: EnvironmentIdType, effect: Effect.Effect<A, E, R>) => effect,
      followStream: <A, E, R>(_environmentId: EnvironmentIdType, stream: Stream.Stream<A, E, R>) =>
        Stream.provideService(stream, EnvironmentSupervisor, supervisor),
    } as unknown as EnvironmentRegistry["Service"];
    const runtime = Atom.runtime(
      Layer.mergeAll(
        Layer.succeed(EnvironmentRegistry, registryStub),
        Layer.succeed(
          ConnectionWakeups.ConnectionWakeups,
          ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.fromQueue(wakeups) }),
        ),
        Layer.succeed(Clock.Clock, testClock),
      ),
    );
    const queryAtom = createEnvironmentQueryAtomFamily(runtime, {
      label: "test.query",
      staleTimeMs,
      execute: (_input: string) => Ref.updateAndGet(executions, (count) => count + 1),
    });
    return {
      executions,
      state,
      wakeups,
      testClock,
      atom: queryAtom({ environmentId: TARGET.environmentId, input: "key" }),
    };
  });

  const settleExecutions = Effect.fn("TestRuntime.settleExecutions")(function* (
    executions: Ref.Ref<number>,
    above: number,
  ) {
    for (let iteration = 0; iteration < 100; iteration += 1) {
      if ((yield* Ref.get(executions)) > above) {
        break;
      }
      yield* Effect.yieldNow;
    }
    return yield* Ref.get(executions);
  });

  it.effect("does not refetch a fresh query when the connection generation bumps", () =>
    Effect.gen(function* () {
      const harness = yield* makeQueryHarness(60_000);
      const registry = AtomRegistry.make();
      const unmount = registry.mount(harness.atom);

      const first = yield* AtomRegistry.getResult(registry, harness.atom, {
        suspendOnWaiting: true,
      });
      expect(first).toBeGreaterThanOrEqual(1);
      // Let any mount-time re-evaluations settle before taking the baseline.
      for (let iteration = 0; iteration < 100; iteration += 1) {
        yield* Effect.yieldNow;
      }
      const baseline = yield* Ref.get(harness.executions);

      yield* SubscriptionRef.set(harness.state, connectedState(2));
      for (let iteration = 0; iteration < 100; iteration += 1) {
        yield* Effect.yieldNow;
      }

      expect(yield* Ref.get(harness.executions)).toBe(baseline);
      const current = registry.get(harness.atom);
      expect(AsyncResult.isSuccess(current)).toBe(true);
      if (AsyncResult.isSuccess(current)) {
        expect(current.value).toBe(baseline);
        expect(current.waiting).toBe(false);
      }

      unmount();
      registry.dispose();
    }),
  );

  it.effect("refetches a stale query when the connection generation bumps", () =>
    Effect.gen(function* () {
      const harness = yield* makeQueryHarness(0);
      const registry = AtomRegistry.make();
      const unmount = registry.mount(harness.atom);

      const first = yield* AtomRegistry.getResult(registry, harness.atom, {
        suspendOnWaiting: true,
      });
      expect(first).toBeGreaterThanOrEqual(1);
      // Mounting can evaluate the read more than once (the runtime context
      // resolves on its own tick), so drain those evaluations before taking
      // the baseline.
      for (let iteration = 0; iteration < 100; iteration += 1) {
        yield* Effect.yieldNow;
      }
      const baseline = yield* Ref.get(harness.executions);
      expect(baseline).toBeGreaterThanOrEqual(1);

      yield* SubscriptionRef.set(harness.state, connectedState(2));
      for (let iteration = 0; iteration < 100; iteration += 1) {
        if ((yield* Ref.get(harness.executions)) > baseline) {
          break;
        }
        yield* Effect.yieldNow;
      }

      expect(yield* Ref.get(harness.executions)).toBe(baseline + 1);
      expect(
        yield* AtomRegistry.getResult(registry, harness.atom, { suspendOnWaiting: true }),
      ).toBe(baseline + 1);

      unmount();
      registry.dispose();
    }),
  );

  it.effect("refetches a stale query after a long foreground return keeps its session", () =>
    Effect.gen(function* () {
      const harness = yield* makeQueryHarness(0);
      const registry = AtomRegistry.make();
      const unmount = registry.mount(harness.atom);

      yield* AtomRegistry.getResult(registry, harness.atom, { suspendOnWaiting: true });
      for (let iteration = 0; iteration < 100; iteration += 1) {
        yield* Effect.yieldNow;
      }
      const baseline = yield* Ref.get(harness.executions);

      // The session survives the wake probe: nothing happens until the probe
      // window has passed, then the epoch ticks once.
      yield* Queue.offer(harness.wakeups, "application-active-reconnect");
      for (let iteration = 0; iteration < 20; iteration += 1) {
        yield* Effect.yieldNow;
      }
      expect(yield* Ref.get(harness.executions)).toBe(baseline);
      yield* harness.testClock.adjust("3500 millis");
      expect(yield* settleExecutions(harness.executions, baseline)).toBe(baseline + 1);

      // A session replaced during the window revalidates through its new
      // generation only, never twice.
      yield* Queue.offer(harness.wakeups, "application-active-reconnect");
      for (let iteration = 0; iteration < 20; iteration += 1) {
        yield* Effect.yieldNow;
      }
      yield* SubscriptionRef.set(harness.state, connectedState(2));
      const afterReplacement = yield* settleExecutions(harness.executions, baseline + 1);
      expect(afterReplacement).toBe(baseline + 2);
      yield* harness.testClock.adjust("3500 millis");
      for (let iteration = 0; iteration < 20; iteration += 1) {
        yield* Effect.yieldNow;
      }
      expect(yield* Ref.get(harness.executions)).toBe(baseline + 2);

      unmount();
      registry.dispose();
    }),
  );

  it.effect("refetches a fresh query when the atom is refreshed", () =>
    Effect.gen(function* () {
      const harness = yield* makeQueryHarness(60_000);
      const registry = AtomRegistry.make();
      const unmount = registry.mount(harness.atom);

      const first = yield* AtomRegistry.getResult(registry, harness.atom, {
        suspendOnWaiting: true,
      });
      expect(first).toBeGreaterThanOrEqual(1);
      for (let iteration = 0; iteration < 100; iteration += 1) {
        yield* Effect.yieldNow;
      }
      const baseline = yield* Ref.get(harness.executions);

      registry.refresh(harness.atom);
      for (let iteration = 0; iteration < 100; iteration += 1) {
        if ((yield* Ref.get(harness.executions)) > baseline) {
          break;
        }
        yield* Effect.yieldNow;
      }

      expect(yield* Ref.get(harness.executions)).toBe(baseline + 1);
      expect(
        yield* AtomRegistry.getResult(registry, harness.atom, { suspendOnWaiting: true }),
      ).toBe(baseline + 1);

      unmount();
      registry.dispose();
    }),
  );
});
