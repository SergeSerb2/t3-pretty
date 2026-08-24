import { EnvironmentId, type EnvironmentId as EnvironmentIdType } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import { EnvironmentNotRegisteredError, EnvironmentRegistry } from "../connection/registry.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import {
  type EnvironmentRpcInput,
  type EnvironmentRpcStreamFailure,
  type EnvironmentRpcStreamValue,
  type EnvironmentStreamCommandRpcTag,
  type EnvironmentSubscriptionRpcTag,
  type EnvironmentUnaryRpcTag,
  request,
  runStream,
  subscribe,
} from "../rpc/client.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";

interface EnvironmentAtomOptions<Input, A, E, R> {
  readonly label: string;
  readonly execute: (input: Input) => Effect.Effect<A, E, R>;
  readonly scheduler?: AtomCommandScheduler;
  readonly concurrency?: AtomCommandConcurrency<{
    readonly environmentId: EnvironmentIdType;
    readonly input: Input;
  }>;
}

interface EnvironmentCommandAtomOptions<Input, A, E, R> extends Omit<
  EnvironmentAtomOptions<Input, A, E, R>,
  "execute"
> {
  readonly execute: (
    input: Input,
    registry: AtomRegistry.AtomRegistry,
    environmentId: EnvironmentIdType,
  ) => Effect.Effect<A, E, R>;
}

interface EnvironmentQueryAtomOptions<Input, A, E, R> extends EnvironmentAtomOptions<
  Input,
  A,
  E,
  R
> {
  readonly staleTimeMs?: number;
  readonly idleTtlMs?: number;
  readonly refreshIntervalMs?: number;
}

interface EnvironmentSubscriptionAtomOptions<Input, A, E, R> {
  readonly label: string;
  readonly subscribe: (input: Input) => Stream.Stream<A, E, R>;
  readonly idleTtlMs?: number;
  /**
   * Finite command streams do not resubscribe on their own. When true, a
   * connection-generation bump tears down the previous stream and starts a
   * fresh subscribe so a mid-scan disconnect cannot leave the last
   * in-progress snapshot stuck.
   */
  readonly restartOnReconnect?: boolean;
}

export type SettledAsyncResult<A, E> = AsyncResult.Success<A, E> | AsyncResult.Failure<A, E>;

export type AtomCommandResult<A, E> = SettledAsyncResult<A, E>;

export type AtomCommandSuccess<R> = R extends AtomCommandResult<infer A, infer _E> ? A : never;

export type AtomCommandFailure<R> = R extends AtomCommandResult<infer _A, infer E> ? E : never;

export interface AtomCommandOptions {
  readonly label?: string;
  readonly reportFailure?: boolean;
  readonly reportDefect?: boolean;
}

export interface AtomCommandReporter {
  readonly warn: (message: string, cause: Cause.Cause<unknown>) => void;
  readonly error: (message: string, cause: Cause.Cause<unknown>) => void;
}

export interface AtomCommand<W, A, E> {
  readonly label: string;
  readonly run: (registry: AtomRegistry.AtomRegistry, input: W) => Promise<AtomCommandResult<A, E>>;
}

export type AtomCommandConcurrency<W> =
  /** Every invocation runs independently. */
  | { readonly mode: "parallel" }
  | {
      /**
       * `serial` preserves every invocation in FIFO order, `singleFlight` shares an active
       * invocation, and `latest` coalesces queued invocations to the newest input.
       */
      readonly mode: "serial" | "singleFlight" | "latest";
      readonly key: (input: W) => string;
    };

interface AtomCommandSchedulerState {
  readonly serial: Map<string, Promise<unknown>>;
  readonly singleFlight: Map<string, Promise<unknown>>;
  readonly latest: Map<string, AtomCommandLatestLane>;
}

interface AtomCommandLatestBatch {
  execute: () => Promise<AtomCommandResult<unknown, unknown>>;
  readonly promise: Promise<AtomCommandResult<unknown, unknown>>;
  readonly resolve: (result: AtomCommandResult<unknown, unknown>) => void;
}

interface AtomCommandLatestLane {
  running: boolean;
  pending: AtomCommandLatestBatch | undefined;
}

export interface AtomCommandScheduler {
  readonly schedule: <W, A, E>(
    registry: AtomRegistry.AtomRegistry,
    concurrency: AtomCommandConcurrency<W>,
    input: W,
    execute: () => Promise<AtomCommandResult<A, E>>,
  ) => Promise<AtomCommandResult<A, E>>;
}

async function settleAtomCommandResult<A, E>(
  execute: () => Promise<AtomCommandResult<A, E>>,
): Promise<AtomCommandResult<A, E>> {
  try {
    return await execute();
  } catch (defect) {
    return AsyncResult.failure(Cause.die(defect));
  }
}

export function createAtomCommandScheduler(): AtomCommandScheduler {
  const registryStates = new WeakMap<AtomRegistry.AtomRegistry, AtomCommandSchedulerState>();

  const stateFor = (registry: AtomRegistry.AtomRegistry): AtomCommandSchedulerState => {
    const existing = registryStates.get(registry);
    if (existing !== undefined) {
      return existing;
    }
    const state: AtomCommandSchedulerState = {
      serial: new Map(),
      singleFlight: new Map(),
      latest: new Map(),
    };
    registryStates.set(registry, state);
    return state;
  };

  return {
    schedule: <W, A, E>(
      registry: AtomRegistry.AtomRegistry,
      concurrency: AtomCommandConcurrency<W>,
      input: W,
      execute: () => Promise<AtomCommandResult<A, E>>,
    ): Promise<AtomCommandResult<A, E>> => {
      if (concurrency.mode === "parallel") {
        return execute();
      }

      const key = concurrency.key(input);
      const state = stateFor(registry);
      if (concurrency.mode === "singleFlight") {
        const existing = state.singleFlight.get(key) as
          | Promise<AtomCommandResult<A, E>>
          | undefined;
        if (existing !== undefined) {
          return existing;
        }
        const current = execute();
        state.singleFlight.set(key, current);
        void current.then(
          () => {
            if (state.singleFlight.get(key) === current) {
              state.singleFlight.delete(key);
            }
          },
          () => {
            if (state.singleFlight.get(key) === current) {
              state.singleFlight.delete(key);
            }
          },
        );
        return current;
      }

      if (concurrency.mode === "serial") {
        const previous = state.serial.get(key);
        const current = previous === undefined ? execute() : previous.then(execute, execute);
        state.serial.set(key, current);
        void current.then(
          () => {
            if (state.serial.get(key) === current) {
              state.serial.delete(key);
            }
          },
          () => {
            if (state.serial.get(key) === current) {
              state.serial.delete(key);
            }
          },
        );
        return current;
      }

      let lane = state.latest.get(key);
      if (lane === undefined) {
        lane = { running: false, pending: undefined };
        state.latest.set(key, lane);
      }
      const activeLane = lane;

      if (activeLane.pending === undefined) {
        let resolveBatch!: (result: AtomCommandResult<unknown, unknown>) => void;
        const promise = new Promise<AtomCommandResult<unknown, unknown>>((resolve) => {
          resolveBatch = resolve;
        });
        activeLane.pending = {
          execute: execute as () => Promise<AtomCommandResult<unknown, unknown>>,
          promise,
          resolve: resolveBatch,
        };
      } else {
        // Every call coalesced into this batch observes the same latest result,
        // so share one promise instead of retaining one resolver per caller
        // while a slow command is in flight.
        activeLane.pending.execute = execute as () => Promise<AtomCommandResult<unknown, unknown>>;
      }
      const result = activeLane.pending.promise as Promise<AtomCommandResult<A, E>>;

      if (!activeLane.running) {
        activeLane.running = true;
        void (async () => {
          while (activeLane.pending !== undefined) {
            const batch = activeLane.pending;
            activeLane.pending = undefined;
            let batchResult: AtomCommandResult<unknown, unknown>;
            try {
              batchResult = await batch.execute();
            } catch (defect) {
              batchResult = AsyncResult.failure(Cause.die(defect));
            }
            batch.resolve(batchResult);
          }
          activeLane.running = false;
          if (state.latest.get(key) === activeLane) {
            state.latest.delete(key);
          }
        })();
      }

      return result;
    },
  };
}

/** Runs one effect inside an existing command scheduler lane. */
export function scheduleAtomCommandEffect<W, A, E, R>(
  registry: AtomRegistry.AtomRegistry,
  scheduler: AtomCommandScheduler,
  concurrency: AtomCommandConcurrency<W>,
  input: W,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const result = yield* Effect.promise((signal) =>
      scheduler.schedule<W, A, E>(registry, concurrency, input, async () => {
        const exit = await Effect.runPromiseExitWith(context)(effect, { signal });
        return Exit.isSuccess(exit)
          ? AsyncResult.success(exit.value)
          : AsyncResult.failure(exit.cause);
      }),
    );
    return result._tag === "Success" ? result.value : yield* Effect.failCause(result.cause);
  });
}

export async function runAtomCommand<W, A, E>(
  registry: AtomRegistry.AtomRegistry,
  command: AtomCommand<W, A, E>,
  input: W,
  options: AtomCommandOptions = {},
  reporter: AtomCommandReporter = console,
): Promise<AtomCommandResult<A, E>> {
  const result = await settleAtomCommandResult(() => command.run(registry, input));
  reportAtomCommandResult(result, { ...options, label: options.label ?? command.label }, reporter);
  return result;
}

export function mapAtomCommandResult<A, E, B>(
  result: AtomCommandResult<A, E>,
  map: (value: A) => B,
): AtomCommandResult<B, E> {
  return result._tag === "Success"
    ? AsyncResult.success(map(result.value))
    : AsyncResult.failure(result.cause);
}

/**
 * Effect squashes an interrupt-only cause to this exact message. RPC layers
 * sometimes re-wrap it as a Fail/Die, so matching the text is what still sees
 * a cancelled read after it has crossed the wire.
 */
const ATOM_INTERRUPT_MESSAGE = "all fibers interrupted without error";

export function isAtomCauseInterrupted(cause: Cause.Cause<unknown>): boolean {
  if (Cause.hasInterruptsOnly(cause)) {
    return true;
  }
  const squashed = Cause.squash(cause);
  const message =
    typeof squashed === "string" ? squashed : squashed instanceof Error ? squashed.message : "";
  return message.trim().toLowerCase() === ATOM_INTERRUPT_MESSAGE;
}

export function isAtomCommandInterrupted(result: AtomCommandResult<unknown, unknown>): boolean {
  return result._tag === "Failure" && isAtomCauseInterrupted(result.cause);
}

export function formatAtomQueryError(cause: Cause.Cause<unknown>): string {
  if (isAtomCauseInterrupted(cause)) {
    return "The environment request failed.";
  }
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  // RPC defects can surface as plain values — an older server answers an
  // unknown method with the string defect `Unknown request tag: <method>` —
  // so show them instead of hiding behind the generic fallback.
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "The environment request failed.";
}

export function isSettledAtomQueryInterrupt<A, E>(result: AsyncResult.AsyncResult<A, E>): boolean {
  return result._tag === "Failure" && !result.waiting && isAtomCauseInterrupted(result.cause);
}

export function readAtomQueryResult<A, E>(
  result: AsyncResult.AsyncResult<A, E>,
): {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
} {
  const data = Option.getOrNull(AsyncResult.value(result));
  if (result._tag === "Failure" && isAtomCauseInterrupted(result.cause)) {
    return {
      data,
      error: null,
      // A cancelled read is not a failure the reader can act on. With no
      // previous answer it is still in flight; with one, keep showing it.
      isPending: result.waiting || data === null,
    };
  }
  return {
    data,
    error: result._tag === "Failure" ? formatAtomQueryError(result.cause) : null,
    isPending: result.waiting,
  };
}

/** One auto-retry per generation. The same cancelled query cannot spin refresh(). */
export function claimAtomQueryInterruptRetry(
  claimedGeneration: { current: unknown },
  generation: unknown,
): boolean {
  if (Object.is(claimedGeneration.current, generation)) {
    return false;
  }
  claimedGeneration.current = generation;
  return true;
}

export function squashAtomCommandFailure(result: {
  readonly cause: Cause.Cause<unknown>;
}): unknown {
  return Cause.squash(result.cause);
}

export async function settleAsyncResult<A, E>(
  execute: () => Promise<Exit.Exit<A, E>>,
): Promise<SettledAsyncResult<A, E>> {
  try {
    return AsyncResult.fromExit(await execute());
  } catch (defect) {
    return AsyncResult.failure(Cause.die(defect));
  }
}

export async function executeAtomCommand<A, E>(
  execute: () => Promise<Exit.Exit<A, E>>,
  options: AtomCommandOptions = {},
  reporter: AtomCommandReporter = console,
): Promise<AtomCommandResult<A, E>> {
  const result = await settleAsyncResult(execute);
  reportAtomCommandResult(result, options, reporter);
  return result;
}

export async function executeAtomQuery<A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  options: AtomCommandOptions = {},
  reporter: AtomCommandReporter = console,
): Promise<AtomCommandResult<A, E>> {
  const query = Effect.scoped(
    Effect.gen(function* () {
      yield* AtomRegistry.mount(registry, atom);
      return yield* AtomRegistry.getResult(registry, atom, {
        suspendOnWaiting: true,
      });
    }),
  );
  return executeAtomCommand(() => Effect.runPromiseExit(query), options, reporter);
}

export function createRuntimeCommand<R, ER, W, A, E>(
  runtime: Atom.AtomRuntime<R, ER>,
  options: {
    readonly label: string;
    readonly execute: (input: W, registry: AtomRegistry.AtomRegistry) => Effect.Effect<A, E, R>;
    readonly scheduler?: AtomCommandScheduler;
    readonly concurrency?: AtomCommandConcurrency<W>;
  },
): AtomCommand<W, A, E | ER> {
  const scheduler = options.scheduler ?? createAtomCommandScheduler();
  const concurrency = options.concurrency ?? { mode: "parallel" as const };
  return {
    label: options.label,
    run: (registry, input) =>
      settleAtomCommandResult(() =>
        scheduler.schedule(registry, concurrency, input, () => {
          const atom = runtime
            .atom(options.execute(input, registry))
            .pipe(Atom.withLabel(options.label));
          return executeAtomQuery(registry, atom, { reportDefect: false, reportFailure: false });
        }),
      ),
  };
}

export function createRuntimeStreamCommand<R, ER, W, A, E>(
  runtime: Atom.AtomRuntime<R, ER>,
  options: {
    readonly label: string;
    readonly execute: (input: W, registry: AtomRegistry.AtomRegistry) => Stream.Stream<A, E, R>;
    readonly scheduler?: AtomCommandScheduler;
    readonly concurrency?: AtomCommandConcurrency<W>;
  },
): AtomCommand<W, A, E | ER | Cause.NoSuchElementError> {
  const scheduler = options.scheduler ?? createAtomCommandScheduler();
  const concurrency = options.concurrency ?? { mode: "parallel" as const };
  return {
    label: options.label,
    run: (registry, input) =>
      settleAtomCommandResult(() =>
        scheduler.schedule(registry, concurrency, input, () => {
          const atom = runtime
            .atom(options.execute(input, registry))
            .pipe(Atom.withLabel(options.label));
          return executeAtomQuery(registry, atom, { reportDefect: false, reportFailure: false });
        }),
      ),
  };
}

export function reportAtomCommandResult(
  result: AtomCommandResult<unknown, unknown>,
  options: AtomCommandOptions = {},
  reporter: AtomCommandReporter = console,
): void {
  if (AsyncResult.isSuccess(result) || Cause.hasInterruptsOnly(result.cause)) {
    return;
  }

  const label = options.label ?? "atom command";
  if (Cause.hasDies(result.cause)) {
    if (options.reportDefect ?? true) {
      reporter.error(`[atom-command] ${label} defected`, result.cause);
    }
  } else if (options.reportFailure ?? true) {
    reporter.warn(`[atom-command] ${label} failed`, result.cause);
  }
}

export async function settlePromise<A>(
  execute: () => Promise<A>,
): Promise<AtomCommandResult<A, never>> {
  try {
    return AsyncResult.success(await execute());
  } catch (defect) {
    return AsyncResult.failure(Cause.die(defect));
  }
}

export function environmentRpcKey<Input>(target: {
  readonly environmentId: EnvironmentIdType;
  readonly input: Input;
}): string {
  return JSON.stringify([target.environmentId, target.input]);
}

function parseEnvironmentRpcKey<Input>(key: string): {
  readonly environmentId: EnvironmentIdType;
  readonly input: Input;
} {
  const decoded = JSON.parse(key) as [EnvironmentIdType, Input];
  return {
    environmentId: EnvironmentId.make(decoded[0]),
    input: decoded[1],
  };
}

export function runInEnvironment<A, E, R>(
  environmentId: EnvironmentIdType,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | EnvironmentNotRegisteredError,
  EnvironmentRegistry | Exclude<R, EnvironmentSupervisor>
> {
  return EnvironmentRegistry.pipe(
    Effect.flatMap((registry) => registry.run(environmentId, effect)),
  );
}

export function runStreamInEnvironment<A, E, R>(
  environmentId: EnvironmentIdType,
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<
  A,
  E | EnvironmentNotRegisteredError,
  EnvironmentRegistry | Exclude<R, EnvironmentSupervisor>
> {
  return Stream.unwrap(
    EnvironmentRegistry.pipe(Effect.map((registry) => registry.runStream(environmentId, stream))),
  );
}

export function followStreamInEnvironment<A, E, R>(
  environmentId: EnvironmentIdType,
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<A, E, EnvironmentRegistry | Exclude<R, EnvironmentSupervisor>> {
  return Stream.unwrap(
    EnvironmentRegistry.pipe(
      Effect.map((registry) => registry.followStream(environmentId, stream)),
    ),
  );
}

// Mirrors the freshness check inside Atom.swr (timestamp of the latest
// success, including a failure's previous success) so a bumped connection
// generation only refetches queries whose data is older than their staleTime.
const isFreshSettledResult = <A, E>(
  result: AsyncResult.AsyncResult<A, E>,
  staleTimeMs: number,
): boolean => {
  if (result.waiting) {
    return false;
  }
  const timestamp =
    result._tag === "Success"
      ? result.timestamp
      : result._tag === "Failure"
        ? Option.getOrUndefined(Option.map(result.previousSuccess, (success) => success.timestamp))
        : undefined;
  // AsyncResult timestamps are wall-clock (Date.now), so freshness is too;
  // this read runs synchronously inside an atom and cannot lift a Clock.
  // @effect-diagnostics-next-line globalDate:off
  return timestamp !== undefined && Date.now() - timestamp < staleTimeMs;
};

// Long enough for the supervisor's mobile wake probe (3s) to have settled.
const FOREGROUND_REVALIDATION_SETTLE_MS = 3_500;

export function createEnvironmentQueryAtomFamily<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: EnvironmentQueryAtomOptions<Input, A, E, EnvironmentSupervisor | R>,
): (target: {
  readonly environmentId: EnvironmentIdType;
  readonly input: Input;
}) => Atom.Atom<AsyncResult.AsyncResult<A, E | ER | Error>> {
  // Revalidation epoch: ticks on every connected generation (a reconnect) and
  // on a foreground return after a long background stint whose session
  // survived — the data is just as old either way, and the staleTime gate
  // below decides per query whether that age warrants a refetch. The survivor
  // tick waits out the supervisor's wake probe so a session that turns out to
  // be dead revalidates once, through its replacement's generation, instead of
  // first on the dead socket.
  const rpcGenerationAtom = Atom.family((environmentId: EnvironmentIdType) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          Effect.gen(function* () {
            const supervisor = yield* EnvironmentSupervisor;
            const wakeups = yield* Effect.serviceOption(ConnectionWakeups.ConnectionWakeups);
            const generations = SubscriptionRef.changes(supervisor.state).pipe(
              Stream.filterMap((state) =>
                state.phase === "connected" ? Result.succeed(state.generation) : Result.failVoid,
              ),
              Stream.changes,
            );
            const connectedGeneration = SubscriptionRef.get(supervisor.state).pipe(
              Effect.map((state) => (state.phase === "connected" ? state.generation : null)),
            );
            const foregroundReturns = Option.match(wakeups, {
              onNone: () => Stream.never,
              onSome: (service) =>
                service.changes.pipe(
                  Stream.filter((reason) => reason === "application-active-reconnect"),
                  Stream.mapEffect(() => connectedGeneration),
                  Stream.filter((generation) => generation !== null),
                  Stream.mapEffect((generation) =>
                    Effect.sleep(FOREGROUND_REVALIDATION_SETTLE_MS).pipe(
                      Effect.andThen(connectedGeneration),
                      Effect.map((current) => current === generation),
                    ),
                  ),
                  Stream.filter((survived) => survived),
                ),
            });
            return Stream.merge(generations, foregroundReturns).pipe(
              Stream.mapAccum(
                () => 0,
                (epoch) => [epoch + 1, [epoch + 1]] as const,
              ),
              Stream.map<number, number | null>((epoch) => epoch),
            );
          }),
        ),
      ),
      { initialValue: null },
    ),
  );
  const family = Atom.family((key: string) => {
    const target = parseEnvironmentRpcKey<Input>(key);
    const idleTtlMs = options.idleTtlMs ?? 5 * 60_000;
    const staleTimeMs = options.staleTimeMs ?? 30_000;
    // Atom.swr already skips automatic revalidation while data is fresh, but
    // this inner read also short-circuits on reconnect (epoch bump).
    // Manual `registry.refresh` must still hit the server — otherwise a
    // mutation's onSettled refresh is a no-op for 30s and the UI stays stale.
    let skipStaleTime = false;
    const queryAtom = runtime
      .atom((get) => {
        const generation = Option.getOrNull(
          AsyncResult.value(get(rpcGenerationAtom(target.environmentId))),
        );
        if (generation === null) {
          return Effect.never;
        }
        const execute = runInEnvironment(target.environmentId, options.execute(target.input));
        const previous = get.self<AsyncResult.AsyncResult<A, E | ER | Error>>();
        const forceRefresh = skipStaleTime;
        skipStaleTime = false;
        if (
          !forceRefresh &&
          Option.isSome(previous) &&
          isFreshSettledResult(previous.value, staleTimeMs)
        ) {
          return previous.value as unknown as typeof execute;
        }
        return execute;
      })
      .pipe(
        Atom.swr({
          staleTime: staleTimeMs,
          revalidateOnMount: true,
        }),
        Atom.setIdleTTL(idleTtlMs),
      );
    const labeled = (
      options.refreshIntervalMs === undefined
        ? queryAtom
        : queryAtom.pipe(Atom.withRefresh(options.refreshIntervalMs))
    ).pipe(Atom.setIdleTTL(idleTtlMs), Atom.withLabel(`${options.label}:${key}`));
    return withForcedQueryRefresh(labeled, () => {
      skipStaleTime = true;
    });
  });
  return (target) => family(environmentRpcKey(target));
}

function withForcedQueryRefresh<A>(atom: Atom.Atom<A>, onRefresh: () => void): Atom.Atom<A> {
  const previousRefresh = atom.refresh;
  return Object.assign(atom, {
    refresh: (refresh: <B>(next: Atom.Atom<B>) => void) => {
      onRefresh();
      if (previousRefresh !== undefined) {
        previousRefresh(refresh);
        return;
      }
      refresh(atom);
    },
  });
}

export function createEnvironmentSubscriptionAtomFamily<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: EnvironmentSubscriptionAtomOptions<Input, A, E, EnvironmentSupervisor | R>,
) {
  const rpcGenerationAtom = options.restartOnReconnect
    ? Atom.family((environmentId: EnvironmentIdType) =>
        runtime.atom(
          followStreamInEnvironment(
            environmentId,
            Stream.unwrap(
              EnvironmentSupervisor.pipe(
                Effect.map((supervisor) =>
                  SubscriptionRef.changes(supervisor.state).pipe(
                    Stream.filterMap((state) =>
                      state.phase === "connected"
                        ? Result.succeed(state.generation)
                        : Result.failVoid,
                    ),
                    Stream.changes,
                    Stream.map<number, number | null>((generation) => generation),
                  ),
                ),
              ),
            ),
          ),
          { initialValue: null },
        ),
      )
    : null;
  const family = Atom.family((key: string) => {
    const target = parseEnvironmentRpcKey<Input>(key);
    const streamAtom =
      rpcGenerationAtom === null
        ? runtime.atom(
            followStreamInEnvironment(target.environmentId, options.subscribe(target.input)),
          )
        : runtime.atom((get) => {
            const generation = Option.getOrNull(
              AsyncResult.value(get(rpcGenerationAtom(target.environmentId))),
            );
            if (generation === null) {
              return Stream.never;
            }
            return followStreamInEnvironment(target.environmentId, options.subscribe(target.input));
          });
    return streamAtom.pipe(
      Atom.setIdleTTL(options.idleTtlMs ?? 5 * 60_000),
      Atom.withLabel(`${options.label}:${key}`),
    );
  });
  return (target: { readonly environmentId: EnvironmentIdType; readonly input: Input }) =>
    family(environmentRpcKey(target));
}

export function createEnvironmentCommand<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: EnvironmentCommandAtomOptions<Input, A, E, EnvironmentSupervisor | R>,
) {
  return createRuntimeCommand(runtime, {
    label: options.label,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    execute: (target, registry) =>
      runInEnvironment(
        target.environmentId,
        options.execute(target.input, registry, target.environmentId),
      ),
  });
}

function createEnvironmentStreamCommand<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly execute: (input: Input) => Stream.Stream<A, E, EnvironmentSupervisor | R>;
    readonly scheduler?: AtomCommandScheduler;
    readonly concurrency?: AtomCommandConcurrency<{
      readonly environmentId: EnvironmentIdType;
      readonly input: Input;
    }>;
  },
) {
  return createRuntimeStreamCommand(runtime, {
    label: options.label,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    execute: (target) =>
      runStreamInEnvironment(target.environmentId, options.execute(target.input)).pipe(
        Stream.withSpan(options.label),
      ),
  });
}

export function createEnvironmentRpcQueryAtomFamily<R, ER, TTag extends EnvironmentUnaryRpcTag>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
    readonly staleTimeMs?: number;
    readonly idleTtlMs?: number;
    readonly refreshIntervalMs?: number;
  },
) {
  return createEnvironmentQueryAtomFamily(runtime, {
    label: options.label,
    ...(options.staleTimeMs === undefined ? {} : { staleTimeMs: options.staleTimeMs }),
    ...(options.idleTtlMs === undefined ? {} : { idleTtlMs: options.idleTtlMs }),
    ...(options.refreshIntervalMs === undefined
      ? {}
      : { refreshIntervalMs: options.refreshIntervalMs }),
    execute: (input: EnvironmentRpcInput<TTag>) => request(options.tag, input),
  });
}

export function createEnvironmentRpcSubscriptionAtomFamily<
  R,
  ER,
  TTag extends EnvironmentSubscriptionRpcTag,
  B = EnvironmentRpcStreamValue<TTag>,
>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
    readonly idleTtlMs?: number;
    readonly transform?: (
      stream: Stream.Stream<
        EnvironmentRpcStreamValue<TTag>,
        EnvironmentRpcStreamFailure<TTag>,
        EnvironmentSupervisor | R
      >,
    ) => Stream.Stream<B, EnvironmentRpcStreamFailure<TTag>, EnvironmentSupervisor | R>;
  },
) {
  return createEnvironmentSubscriptionAtomFamily(runtime, {
    label: options.label,
    ...(options.idleTtlMs === undefined ? {} : { idleTtlMs: options.idleTtlMs }),
    subscribe: (input: EnvironmentRpcInput<TTag>) => {
      const stream = subscribe(options.tag, input);
      return options.transform === undefined
        ? (stream as Stream.Stream<B, EnvironmentRpcStreamFailure<TTag>, EnvironmentSupervisor | R>)
        : options.transform(stream);
    },
  });
}

export function createEnvironmentRpcCommand<R, ER, TTag extends EnvironmentUnaryRpcTag>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
    readonly scheduler?: AtomCommandScheduler;
    readonly concurrency?: AtomCommandConcurrency<{
      readonly environmentId: EnvironmentIdType;
      readonly input: EnvironmentRpcInput<TTag>;
    }>;
    readonly onSuccess?: (
      target: {
        readonly environmentId: EnvironmentIdType;
        readonly input: EnvironmentRpcInput<TTag>;
      },
      registry: AtomRegistry.AtomRegistry,
    ) => Effect.Effect<void, never, R>;
    readonly onSettled?: (
      target: {
        readonly environmentId: EnvironmentIdType;
        readonly input: EnvironmentRpcInput<TTag>;
      },
      registry: AtomRegistry.AtomRegistry,
    ) => Effect.Effect<void, never, R>;
  },
) {
  return createEnvironmentCommand(runtime, {
    label: options.label,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    execute: (input: EnvironmentRpcInput<TTag>, registry, environmentId) => {
      const target = {
        environmentId,
        input,
      };
      return request(options.tag, input).pipe(
        Effect.tap(() => options.onSuccess?.(target, registry) ?? Effect.void),
        Effect.ensuring(options.onSettled?.(target, registry) ?? Effect.void),
      );
    },
  });
}

export function createEnvironmentRpcStreamCommand<
  R,
  ER,
  TTag extends EnvironmentStreamCommandRpcTag,
>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
    readonly scheduler?: AtomCommandScheduler;
    readonly concurrency?: AtomCommandConcurrency<{
      readonly environmentId: EnvironmentIdType;
      readonly input: EnvironmentRpcInput<TTag>;
    }>;
  },
) {
  return createEnvironmentStreamCommand(runtime, {
    label: options.label,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    execute: (input: EnvironmentRpcInput<TTag>) => runStream(options.tag, input),
  });
}
