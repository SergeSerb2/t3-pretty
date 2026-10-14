import type { QueryPersistence } from "./queryPersistence.ts";
import { createCommandPermissions } from "./commandPermissions.ts";
import { followStreamInEnvironment } from "./environmentStreams.ts";
export { runStreamInEnvironment, followStreamInEnvironment } from "./environmentStreams.ts";
import {
  type ClientGuardedRpcTag,
  EnvironmentId,
  type EnvironmentId as EnvironmentIdType,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import type { ConnectionAttemptError } from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import {
  type EnvironmentRpcInput,
  type EnvironmentRpcSuccess,
  type EnvironmentRpcFailure,
  type EnvironmentRpcStreamFailure,
  type EnvironmentRpcStreamValue,
  type EnvironmentSubscriptionRpcTag,
  type EnvironmentUnaryRpcTag,
  EnvironmentRpcUnavailableError,
  request,
  requestGuarded,
  RpcPermissionGuard,
  subscribe,
} from "../rpc/client.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";

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

interface EnvironmentQueryAtomOptions<Input, A, E, R> extends Omit<
  EnvironmentAtomOptions<Input, A, E, R>,
  "execute"
> {
  /**
   * `emit` shows a provisional value while the query keeps waiting. The settled
   * result replaces it, so catch failures that should keep it on screen.
   */
  readonly execute: (
    input: Input,
    emit: (value: A) => Effect.Effect<void>,
  ) => Effect.Effect<A, E, R>;
  readonly persistence?: QueryPersistence<A>;
  readonly staleTimeMs?: number;
  readonly idleTtlMs?: number;
  readonly refreshIntervalMs?: number;
  readonly refreshTrigger?: (target: {
    readonly environmentId: EnvironmentIdType;
    readonly input: Input;
  }) => Atom.Atom<unknown> | undefined;
  /** A value that can no longer change. It stops the interval and `refreshTrigger` re-reads. */
  readonly isFinal?: (value: A) => boolean;
}

interface EnvironmentSubscriptionAtomOptions<Input, A, E, R> {
  readonly sensitiveInput?: boolean;
  readonly label: string;
  readonly subscribe: (input: Input) => Stream.Stream<A, E, R>;
  readonly completeWhen?: (value: A) => boolean;
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

export interface AtomQueryOptions extends AtomCommandOptions {
  /**
   * Force a fresh execution instead of accepting a value the atom already
   * holds (e.g. an SWR-cached result within its stale window). Used by
   * verification flows where a cached failure must not satisfy a retry.
   */
  readonly refresh?: boolean;
  /** Interrupt the query wait when its caller no longer wants the result. */
  readonly signal?: AbortSignal;
}

export async function executeAtomQuery<A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  options: AtomQueryOptions = {},
  reporter: AtomCommandReporter = console,
): Promise<AtomCommandResult<A, E>> {
  const query = Effect.scoped(
    Effect.gen(function* () {
      yield* AtomRegistry.mount(registry, atom);
      if (options.refresh) {
        yield* Effect.sync(() => {
          // Only a settled value can be a leftover from an earlier read; a
          // computation that mounting just started is already fresh.
          const current = registry.get(atom);
          if (current._tag !== "Initial" && !current.waiting) {
            registry.refresh(atom);
          }
        });
      }
      return yield* AtomRegistry.getResult(registry, atom, {
        suspendOnWaiting: true,
      });
    }),
  );
  return executeAtomCommand(
    () => Effect.runPromiseExit(query, { signal: options.signal }),
    options,
    reporter,
  );
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

function runInEnvironment<A, E, R>(
  environmentId: EnvironmentIdType,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | EnvironmentRegistry.EnvironmentNotRegisteredError,
  EnvironmentRegistry.EnvironmentRegistry | Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>
> {
  return EnvironmentRegistry.EnvironmentRegistry.pipe(
    Effect.flatMap((registry) => registry.run(environmentId, effect)),
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

/**
 * Refreshes a query when its signals change, but only while something reads it.
 * `Atom.makeRefreshOnSignal` subscribes to the signal, so a query that outlives its view on an
 * idle TTL still re-runs on every change. Reading the signal as a dependency instead lets the
 * registry re-run a mounted query right away and only mark an idle one stale, which then
 * refreshes on its next read.
 */
const refreshOnSignalsWhileRead =
  <A>(
    signals: ReadonlyArray<{
      readonly atom: Atom.Atom<unknown>;
      readonly onChange?: () => void;
      readonly refreshWhenFinal?: boolean;
    }>,
    staleTimeMs: number,
    readUnderAtom: Atom.Atom<{ signals: ReadonlyArray<unknown> | undefined }>,
    isFinal: (result: AsyncResult.AsyncResult<A, unknown>) => boolean,
  ) =>
  <E>(self: Atom.Atom<AsyncResult.AsyncResult<A, E>>): Atom.Atom<AsyncResult.AsyncResult<A, E>> => {
    return Atom.transform(
      self,
      (get) => {
        const readUnder = get(readUnderAtom);
        const current = signals.map(({ atom }) => get(atom));
        const firstRead = Option.isNone(get.self());
        const previous = readUnder.signals;
        let changed = false;
        let shouldRefresh = false;
        if (previous !== undefined) {
          for (const [index, signal] of signals.entries()) {
            if (Object.is(previous[index], current[index])) continue;
            changed = true;
            if (signal.refreshWhenFinal || !isFinal(get.once(self))) {
              shouldRefresh = true;
              signal.onChange?.();
            }
          }
        }
        readUnder.signals = current;
        if (shouldRefresh) get.refresh(self);
        // Keep a dependency edge so sweeping this node also releases the
        // source's spent idle TTL, rather than starting another TTL afterward.
        const result = get(self);
        // This outer node can expire while SWR keeps its data. Recheck that
        // data on the next read even when the shared signals have not changed.
        // Source completions must not refresh themselves at staleTime zero.
        if (
          firstRead &&
          !changed &&
          !result.waiting &&
          !isFreshSettledResult(result, staleTimeMs)
        ) {
          let active = true;
          get.addFinalizer(() => {
            active = false;
          });
          get.registry.schedulerAsync.makeDispatcher().scheduleTask(() => {
            if (!active) return;
            const latest = get.once(self);
            if (!latest.waiting && !isFreshSettledResult(latest, staleTimeMs)) {
              get.refresh(self);
            }
          }, 0);
        }
        return result;
      },
      { initialValueTarget: self },
    );
  };

/**
 * `Atom.withRefresh`, except the timer stops once the value is final.
 * A signal target invalidates the read boundary instead of polling an idle cached source.
 */
const refreshEveryUntilFinal =
  <V>(intervalMs: number, isFinal: (value: V) => boolean, refreshSignal?: Atom.Atom<unknown>) =>
  <A extends V>(self: Atom.Atom<A>): Atom.Atom<A> =>
    Atom.transform(
      self,
      (get) => {
        const value = get(self);
        if (!isFinal(value)) {
          // @effect-diagnostics-next-line globalTimers:off - Mirrors `Atom.withRefresh`, outside an Effect runtime.
          const handle = setTimeout(() => get.refresh(refreshSignal ?? self), intervalMs);
          get.addFinalizer(() => clearTimeout(handle));
        }
        return value;
      },
      { initialValueTarget: self },
    );

export function createEnvironmentQueryAtomFamily<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
  options: EnvironmentQueryAtomOptions<
    Input,
    A,
    E,
    | EnvironmentSupervisor.EnvironmentSupervisor
    | EnvironmentRegistry.EnvironmentRegistry
    | AtomRegistry.AtomRegistry
    | R
  >,
): (target: {
  readonly environmentId: EnvironmentIdType;
  readonly input: Input;
}) => Atom.Atom<AsyncResult.AsyncResult<A, E | ER | Error>> {
  // Connection snapshots track the supervisor state and session introduced by
  // upstream. They also repeat after a foreground return whose connected
  // generation survives the mobile wake probe, allowing the staleTime gate
  // below to revalidate old data without first querying a dead socket.
  const connectionAtom = Atom.family((environmentId: EnvironmentIdType) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          Effect.gen(function* () {
            const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
            const wakeups = yield* Effect.serviceOption(ConnectionWakeups.ConnectionWakeups);
            const connections = SubscriptionRef.changes(supervisor.state).pipe(
              Stream.zipLatest(SubscriptionRef.changes(supervisor.session)),
            );
            const connectedGeneration = SubscriptionRef.get(supervisor.state).pipe(
              Effect.map((state) => (state.phase === "connected" ? state.generation : null)),
            );
            const foregroundReturns: Stream.Stream<boolean> = Option.match(wakeups, {
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
            const foregroundSnapshots = foregroundReturns.pipe(
              Stream.mapEffect(() =>
                Effect.all([
                  SubscriptionRef.get(supervisor.state),
                  SubscriptionRef.get(supervisor.session),
                ] as const),
              ),
            );
            return connections.pipe(Stream.merge(foregroundSnapshots));
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
    // this inner read also short-circuits on reconnect-triggered updates.
    // Manual `registry.refresh` must still hit the server — otherwise a
    // mutation's onSettled refresh is a no-op for 30s and the UI stays stale.
    let skipStaleTime = false;
    // A terminal connection error must be retried once connectivity returns,
    // even when its retained previous success is still fresh.
    let retryAfterConnectionUnavailable = false;
    // Definitions can outlive their registry nodes. Keep the original result
    // in registry-owned state so an offline fallback preserves freshness
    // without retaining a disposed registry's large query payload.
    // The raw source also owns this signal history, so it lasts as long as
    // cached source data. This preserves triggers missed while idle, including
    // queued source removal after the outer node expires.
    const queryStateAtom = Atom.make(
      (): {
        previous: AsyncResult.AsyncResult<A, E | ER | Error> | undefined;
        signals: ReadonlyArray<unknown> | undefined;
      } => ({
        previous: undefined,
        signals: undefined,
      }),
    ).pipe(Atom.setIdleTTL(0));
    const queryAtom = runtime
      .atom<
        A,
        | E
        | ConnectionAttemptError
        | EnvironmentRegistry.EnvironmentNotRegisteredError
        | EnvironmentRpcUnavailableError
      >((get) => {
        const cachedFallback = get(queryStateAtom);
        const connection = Option.getOrNull(
          AsyncResult.value(get.once(connectionAtom(target.environmentId))),
        );
        const emit = (value: A) =>
          Effect.sync(() => get.setSelf(AsyncResult.success(value, { waiting: true }))).pipe(
            // A value set while the atom builds wins over the build's own
            // result, so a query that then settled synchronously would stay
            // waiting forever. Suspend on a promise (`yieldNow` is drained
            // inside the build) so the settled result arrives asynchronously.
            Effect.andThen(Effect.promise(() => Promise.resolve())),
          );
        const previousResult = get.self<AsyncResult.AsyncResult<A, E | ER | Error>>();
        // Record terminal unavailability even when persistence supplies a value
        // without entering execute().
        if (
          connection !== null &&
          (connection[0].phase === "available" ||
            connection[0].phase === "offline" ||
            connection[0].phase === "blocked")
        ) {
          retryAfterConnectionUnavailable = true;
        }
        const execute = (): Effect.Effect<
          A,
          | E
          | ConnectionAttemptError
          | EnvironmentRegistry.EnvironmentNotRegisteredError
          | EnvironmentRpcUnavailableError,
          | EnvironmentRegistry.EnvironmentRegistry
          | AtomRegistry.AtomRegistry
          | Exclude<R, EnvironmentSupervisor.EnvironmentSupervisor>
        > => {
          if (connection === null) return Effect.never;
          const [connectionState, session] = connection;
          switch (connectionState.phase) {
            case "connected":
              return Option.isSome(session)
                ? runInEnvironment(target.environmentId, options.execute(target.input, emit))
                : Effect.never;
            case "connecting":
            case "backoff":
              return Effect.never;
            case "available":
            case "offline":
            case "blocked":
              if (connectionState.lastFailure !== null) {
                return Effect.fail(connectionState.lastFailure);
              }
              return Effect.fail(
                new EnvironmentRpcUnavailableError({
                  environmentId: target.environmentId,
                  message: `Environment ${target.environmentId} is ${
                    connectionState.phase === "available" ? "not connected" : connectionState.phase
                  }.`,
                }),
              );
          }
        };
        // Return fresh atom results outside Effect.gen: an AsyncResult is not
        // an Effect that the persistence wrapper can yield from.
        if (
          connection !== null &&
          connection[0].phase === "connected" &&
          Option.isSome(connection[1])
        ) {
          const previous =
            cachedFallback.previous === undefined
              ? previousResult
              : Option.some(cachedFallback.previous);
          const forceRefresh = skipStaleTime || retryAfterConnectionUnavailable;
          skipStaleTime = false;
          retryAfterConnectionUnavailable = false;
          cachedFallback.previous = undefined;
          if (
            !forceRefresh &&
            Option.isSome(previous) &&
            isFreshSettledResult(previous.value, staleTimeMs)
          ) {
            return previous.value as unknown as ReturnType<typeof execute>;
          }
        }
        if (!options.persistence) return execute();
        const persistence = options.persistence;
        const cacheKey = JSON.stringify([options.label, target.input]);
        const previous = Option.flatMap(previousResult, AsyncResult.value);
        return Effect.gen(function* () {
          const cached = Option.isSome(previous)
            ? previous
            : yield* persistence.load(target.environmentId, cacheKey);
          if (
            Option.isSome(cached) &&
            (connection === null || connection[0].phase !== "connected")
          ) {
            if (Option.isNone(previous)) {
              // A value loaded from storage has no live-query freshness proof.
              retryAfterConnectionUnavailable = true;
            } else if (cachedFallback.previous === undefined && Option.isSome(previousResult)) {
              cachedFallback.previous = previousResult.value;
            }
            return cached.value;
          }
          if (Option.isNone(previous) && Option.isSome(cached)) yield* emit(cached.value);
          return yield* execute().pipe(
            Effect.tap((value) => persistence.save(target.environmentId, cacheKey, value)),
          );
        });
      })
      .pipe(
        Atom.swr({
          staleTime: staleTimeMs,
          revalidateOnMount: true,
        }),
        Atom.setIdleTTL(idleTtlMs),
      );
    const isFinal = (result: AsyncResult.AsyncResult<A, unknown>) =>
      options.isFinal !== undefined && Option.exists(AsyncResult.value(result), options.isFinal);
    const intervalSignal =
      options.refreshIntervalMs === undefined
        ? undefined
        : Atom.make((get) => Option.getOrElse(get.self<number>(), () => 0) + 1).pipe(
            Atom.setIdleTTL(idleTtlMs),
          );
    const refreshTrigger = options.refreshTrigger?.(target);
    const intervalQuery =
      options.refreshIntervalMs === undefined
        ? queryAtom
        : queryAtom.pipe(
            refreshEveryUntilFinal(options.refreshIntervalMs, isFinal, intervalSignal),
          );
    // Keep all invalidation signals at the outer read boundary. A subscription
    // held by SWR for cached data must not refetch an unused query on reconnect.
    const labeled = intervalQuery.pipe(
      refreshOnSignalsWhileRead(
        [
          { atom: connectionAtom(target.environmentId), refreshWhenFinal: true },
          ...(intervalSignal === undefined ? [] : [{ atom: intervalSignal }]),
          ...(refreshTrigger === undefined
            ? []
            : [
                {
                  atom: refreshTrigger,
                  // Explicit invalidation must still be able to replace final data.
                  refreshWhenFinal: true,
                  onChange: () => {
                    skipStaleTime = true;
                  },
                },
              ]),
        ],
        staleTimeMs,
        queryStateAtom,
        isFinal,
      ),
      Atom.setIdleTTL(idleTtlMs),
      Atom.withLabel(`${options.label}:${key}`),
    );
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
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
  options: EnvironmentSubscriptionAtomOptions<
    Input,
    A,
    E,
    EnvironmentSupervisor.EnvironmentSupervisor | R
  >,
) {
  const rpcGenerationAtom = options.restartOnReconnect
    ? Atom.family((environmentId: EnvironmentIdType) =>
        runtime.atom(
          followStreamInEnvironment(
            environmentId,
            Stream.unwrap(
              EnvironmentSupervisor.EnvironmentSupervisor.pipe(
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
            followStreamInEnvironment(target.environmentId, options.subscribe(target.input)).pipe(
              options.completeWhen ? Stream.takeUntil(options.completeWhen) : (stream) => stream,
            ),
          )
        : runtime.atom((get) => {
            const generation = Option.getOrNull(
              AsyncResult.value(get(rpcGenerationAtom(target.environmentId))),
            );
            if (generation === null) {
              return Stream.never;
            }
            return followStreamInEnvironment(
              target.environmentId,
              options.subscribe(target.input),
            ).pipe(
              options.completeWhen ? Stream.takeUntil(options.completeWhen) : (stream) => stream,
            );
          });
    return streamAtom.pipe(
      Atom.setIdleTTL(options.idleTtlMs ?? 5 * 60_000),
      Atom.withLabel(
        options.sensitiveInput
          ? `${options.label}:${target.environmentId}`
          : `${options.label}:${key}`,
      ),
    );
  });
  return (target: { readonly environmentId: EnvironmentIdType; readonly input: Input }) =>
    family(environmentRpcKey(target));
}

export function createEnvironmentCommand<R, ER, Input, A, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
  options: EnvironmentCommandAtomOptions<
    Input,
    A,
    E,
    EnvironmentSupervisor.EnvironmentSupervisor | EnvironmentRegistry.EnvironmentRegistry | R
  >,
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

export function createEnvironmentRpcQueryAtomFamily<
  R,
  ER,
  TTag extends Exclude<EnvironmentUnaryRpcTag, ClientGuardedRpcTag>,
>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
    readonly execute?: (
      input: EnvironmentRpcInput<TTag>,
      emit: (value: EnvironmentRpcSuccess<TTag>) => Effect.Effect<void>,
    ) => Effect.Effect<
      EnvironmentRpcSuccess<TTag>,
      EnvironmentRpcFailure<TTag> | EnvironmentRpcUnavailableError,
      EnvironmentSupervisor.EnvironmentSupervisor | EnvironmentRegistry.EnvironmentRegistry
    >;
    readonly persistence?: QueryPersistence<EnvironmentRpcSuccess<TTag>>;
    readonly staleTimeMs?: number;
    readonly idleTtlMs?: number;
    readonly refreshIntervalMs?: number;
    readonly refreshTrigger?: (target: {
      readonly environmentId: EnvironmentIdType;
      readonly input: EnvironmentRpcInput<TTag>;
    }) => Atom.Atom<unknown> | undefined;
    readonly isFinal?: (value: EnvironmentRpcSuccess<TTag>) => boolean;
  },
) {
  return createEnvironmentQueryAtomFamily(runtime, {
    label: options.label,
    ...(options.persistence === undefined ? {} : { persistence: options.persistence }),
    ...(options.staleTimeMs === undefined ? {} : { staleTimeMs: options.staleTimeMs }),
    ...(options.idleTtlMs === undefined ? {} : { idleTtlMs: options.idleTtlMs }),
    ...(options.refreshIntervalMs === undefined
      ? {}
      : { refreshIntervalMs: options.refreshIntervalMs }),
    ...(options.refreshTrigger === undefined ? {} : { refreshTrigger: options.refreshTrigger }),
    ...(options.isFinal === undefined ? {} : { isFinal: options.isFinal }),
    execute: (
      input: EnvironmentRpcInput<TTag>,
      emit: (value: EnvironmentRpcSuccess<TTag>) => Effect.Effect<void>,
    ) => options.execute?.(input, emit) ?? request(options.tag, input),
  });
}

export function createEnvironmentRpcSubscriptionAtomFamily<
  R,
  ER,
  TTag extends EnvironmentSubscriptionRpcTag,
  B = EnvironmentRpcStreamValue<TTag>,
>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
    readonly idleTtlMs?: number;
    readonly completeWhen?: (value: B) => boolean;
    readonly transform?: (
      stream: Stream.Stream<
        EnvironmentRpcStreamValue<TTag>,
        EnvironmentRpcStreamFailure<TTag>,
        EnvironmentSupervisor.EnvironmentSupervisor | R
      >,
    ) => Stream.Stream<
      B,
      EnvironmentRpcStreamFailure<TTag>,
      EnvironmentSupervisor.EnvironmentSupervisor | R
    >;
  },
) {
  return createEnvironmentSubscriptionAtomFamily(runtime, {
    label: options.label,
    ...(options.completeWhen === undefined ? {} : { completeWhen: options.completeWhen }),
    ...(options.idleTtlMs === undefined ? {} : { idleTtlMs: options.idleTtlMs }),
    subscribe: (input: EnvironmentRpcInput<TTag>) => {
      const stream = subscribe(options.tag, input);
      return options.transform === undefined
        ? (stream as Stream.Stream<
            B,
            EnvironmentRpcStreamFailure<TTag>,
            EnvironmentSupervisor.EnvironmentSupervisor | R
          >)
        : options.transform(stream);
    },
  });
}

export function createEnvironmentRpcCommand<
  R,
  ER,
  TTag extends EnvironmentUnaryRpcTag,
  Input extends EnvironmentRpcInput<TTag> = EnvironmentRpcInput<TTag>,
>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
  options: {
    readonly label: string;
    readonly tag: TTag;
    readonly execute?: (
      input: Input,
    ) => Effect.Effect<
      EnvironmentRpcSuccess<TTag>,
      EnvironmentRpcFailure<TTag> | EnvironmentRpcUnavailableError,
      EnvironmentSupervisor.EnvironmentSupervisor | EnvironmentRegistry.EnvironmentRegistry
    >;
    readonly scheduler?: AtomCommandScheduler;
    readonly concurrency?: AtomCommandConcurrency<{
      readonly environmentId: EnvironmentIdType;
      readonly input: NoInfer<Input>;
    }>;
    readonly onSuccess?: (
      target: {
        readonly environmentId: EnvironmentIdType;
        readonly input: NoInfer<Input>;
      },
      registry: AtomRegistry.AtomRegistry,
      result: EnvironmentRpcSuccess<TTag>,
    ) => Effect.Effect<void, never, R>;
    readonly onSettled?: (
      target: {
        readonly environmentId: EnvironmentIdType;
        readonly input: NoInfer<Input>;
      },
      registry: AtomRegistry.AtomRegistry,
    ) => Effect.Effect<void, never, R>;
  },
) {
  const permissions = createCommandPermissions(runtime, options.tag);
  const command = createEnvironmentCommand(runtime, {
    label: options.label,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    execute: (input: Input, registry, environmentId) => {
      const target = {
        environmentId,
        input,
      };
      // Routing requires consent on the origin as well as the actual destination.
      // The transport check below deliberately checks the destination again.
      return permissions.authorize(registry, environmentId, input).pipe(
        Effect.andThen(() => options.execute?.(input) ?? requestGuarded(options.tag, input)),
        Effect.provideService(RpcPermissionGuard, {
          authorize: (id, method, payload) =>
            createCommandPermissions(runtime, method).authorize(registry, id, payload),
        }),
        Effect.tap((result) => options.onSuccess?.(target, registry, result) ?? Effect.void),
        Effect.ensuring(options.onSettled?.(target, registry) ?? Effect.void),
      );
    },
  });
  return {
    ...command,
    requiredScopes: permissions.requiredScopes,
    permissionAtom: permissions.permissionAtom,
  };
}
