import { withRelayClientTracing } from "@t3tools/shared/relayTracing";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Tracer from "effect/Tracer";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import * as Connectivity from "./connectivity.ts";
import * as ConnectionDriver from "./driver.ts";
import {
  type ConnectionAttemptError,
  type ConnectionTarget,
  ConnectionTransientError,
  type NetworkStatus,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./model.ts";
import * as RpcSession from "../rpc/session.ts";
import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import * as ConnectionWakeups from "./wakeups.ts";

// The long tail matters more than the early rungs: the desktop mesh keeps
// every discovered relay environment desired, so a dead environment otherwise
// retries every 16s forever, and each relay attempt is a billed Worker request
// (~5,400/day per offline environment per client). The 5-minute cap bounds
// that to ~288/day; application-active and network-change wakeups still reset
// the ladder, so a user returning to the app reconnects immediately.
const RETRY_DELAYS_MS = [3_000, 4_000, 8_000, 16_000, 32_000, 60_000, 120_000, 300_000] as const;
const CONNECTION_ESTABLISHMENT_TIMEOUT = "15 seconds";
const CONNECTION_PROBE_TIMEOUT = "15 seconds";
const MOBILE_CONNECTION_PROBE_TIMEOUT = "3 seconds";
// Head start the wake probe gets before a replacement lease is opened next to
// it. A healthy socket answers within one round trip, so the replacement (a
// ticket, a handshake and a config fetch per environment) is only ever paid
// when the old transport is in real doubt.
const REPLACEMENT_HEAD_START = "500 millis";
const BACKOFF_RESET_AFTER_MS = 30_000;

interface SupervisorIntent {
  readonly desired: boolean;
  readonly network: NetworkStatus;
}

type SupervisorSignal =
  | { readonly _tag: "ConnectRequested" }
  | { readonly _tag: "DisconnectRequested" }
  | { readonly _tag: "RetryRequested" }
  | { readonly _tag: "NetworkChanged"; readonly network: NetworkStatus }
  | { readonly _tag: "Wakeup"; readonly reason: ConnectionWakeups.ConnectionWakeup };

interface PendingRetryTrace {
  readonly previousAttempt: Tracer.Span;
  readonly failureCount: number;
  readonly delayMs: number;
  readonly reason: ConnectionAttemptError["reason"];
}

interface TracedAttemptFailure {
  readonly error: ConnectionAttemptError;
  readonly attemptSpan: Option.Option<Tracer.Span>;
}

type AttemptOutcome =
  | {
      readonly _tag: "Interrupted";
      readonly established: boolean;
      readonly stable: boolean;
      readonly resetRetry: boolean;
      readonly generation: number;
      readonly replaced: boolean;
    }
  | {
      readonly _tag: "Failure";
      readonly established: boolean;
      readonly stable: boolean;
      readonly failure: TracedAttemptFailure;
      readonly generation: number;
      readonly replaced: boolean;
    };

// A lease plus the scope that owns its transport, so a replacement lease can be
// opened while the previous one is still published and the loser released on
// its own.
interface ActiveLease {
  readonly lease: ConnectionDriver.EnvironmentConnectionLease;
  readonly scope: Scope.Closeable;
  readonly attemptSpan: Option.Option<Tracer.Span>;
}

type MonitorOutcome =
  | { readonly _tag: "Release" }
  | { readonly _tag: "Replace"; readonly next: ActiveLease };

type MonitorEvent =
  | { readonly _tag: "Signal"; readonly signal: SupervisorSignal }
  | { readonly _tag: "Closed"; readonly error: ConnectionTransientError }
  | { readonly _tag: "ProbeSettled"; readonly exit: Exit.Exit<void, ConnectionAttemptError> }
  | { readonly _tag: "ReplacementDue" }
  | {
      readonly _tag: "ReplacementSettled";
      readonly exit: Exit.Exit<ActiveLease, TracedAttemptFailure>;
    };

type EstablishmentEvent =
  | {
      readonly _tag: "Completed";
      readonly exit: Exit.Exit<
        {
          readonly attemptSpan: Option.Option<Tracer.Span>;
          readonly lease: ConnectionDriver.EnvironmentConnectionLease;
        },
        TracedAttemptFailure
      >;
    }
  | { readonly _tag: "Interrupted"; readonly resetRetry: boolean }
  | { readonly _tag: "TimedOut" };

function exitUnlessInterrupted<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Exit.Exit<A, E>, never, R> {
  return Effect.matchCauseEffect(effect, {
    onFailure: (cause) =>
      Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(Exit.failCause(cause)),
    onSuccess: (value) => Effect.succeed(Exit.succeed(value)),
  });
}

export interface EnvironmentSupervisorOptions {
  readonly initiallyDesired?: boolean;
}

function retryDelayMs(failureCount: number): number {
  return RETRY_DELAYS_MS[Math.min(failureCount, RETRY_DELAYS_MS.length - 1)] ?? 300_000;
}

// Applies ±20% jitter so environments recovering from a shared outage do not
// retry in lockstep.
const withRetryJitter = (delayMs: number): Effect.Effect<number> =>
  Effect.map(Random.next, (factor) => Math.round(delayMs * (0.8 + factor * 0.4)));

function annotateTarget(target: ConnectionTarget) {
  return Effect.annotateCurrentSpan({
    "environment.id": target.environmentId,
    "environment.label": target.label,
    "environment.target.kind": target._tag,
  });
}

function availableState(intent: SupervisorIntent, generation: number): SupervisorConnectionState {
  return {
    desired: false,
    network: intent.network,
    phase: "available",
    stage: null,
    attempt: 0,
    generation,
    lastFailure: null,
    retryAt: null,
  };
}

function offlineState(
  intent: SupervisorIntent,
  generation: number,
  attempt: number,
  lastFailure: ConnectionAttemptError | null,
): SupervisorConnectionState {
  return {
    desired: true,
    network: intent.network,
    phase: "offline",
    stage: null,
    attempt,
    generation,
    lastFailure,
    retryAt: null,
  };
}

function connectingState(
  intent: SupervisorIntent,
  generation: number,
  attempt: number,
  lastFailure: ConnectionAttemptError | null,
  stage: SupervisorConnectionState["stage"] = "preparing",
): SupervisorConnectionState {
  return {
    desired: true,
    network: intent.network,
    phase: "connecting",
    stage,
    attempt,
    generation,
    lastFailure,
    retryAt: null,
  };
}

function failureFromExit<A>(
  target: ConnectionTarget,
  exit: Exit.Exit<A, TracedAttemptFailure>,
  established: boolean,
  stable: boolean,
  generation: number,
  replaced = false,
): AttemptOutcome {
  if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) {
    return { _tag: "Interrupted", established, stable, resetRetry: false, generation, replaced };
  }
  const typedFailure = exit.cause.reasons.find(Cause.isFailReason);
  if (typedFailure) {
    return {
      _tag: "Failure",
      established,
      stable,
      failure: typedFailure.error,
      generation,
      replaced,
    };
  }
  return {
    _tag: "Failure",
    established,
    stable,
    failure: {
      error: new ConnectionTransientError({
        reason: "transport",
        detail: `${target.label} connection failed unexpectedly.`,
      }),
      attemptSpan: Option.none(),
    },
    generation,
    replaced,
  };
}

export class EnvironmentSupervisor extends Context.Service<
  EnvironmentSupervisor,
  {
    readonly target: ConnectionTarget;
    readonly state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>;
    readonly session: SubscriptionRef.SubscriptionRef<Option.Option<RpcSession.RpcSession>>;
    readonly prepared: SubscriptionRef.SubscriptionRef<Option.Option<PreparedConnection>>;
    readonly connect: Effect.Effect<void>;
    readonly disconnect: Effect.Effect<void>;
    readonly retryNow: Effect.Effect<void>;
  }
>()("@t3tools/client-runtime/connection/supervisor/EnvironmentSupervisor") {}

export const make = Effect.fn("EnvironmentSupervisor.make")(function* (
  entry: ConnectionCatalogEntry,
  options?: EnvironmentSupervisorOptions,
): Effect.fn.Return<
  EnvironmentSupervisor["Service"],
  never,
  | Connectivity.Connectivity
  | ConnectionDriver.ConnectionDriver
  | Scope.Scope
  | ConnectionWakeups.ConnectionWakeups
> {
  const target = entry.target;
  yield* annotateTarget(target);

  const connectivity = yield* Connectivity.Connectivity;
  const driver = yield* ConnectionDriver.ConnectionDriver;
  const wakeups = yield* ConnectionWakeups.ConnectionWakeups;
  const initialIntent: SupervisorIntent = {
    desired: options?.initiallyDesired ?? false,
    network: yield* connectivity.status,
  };
  const intent = yield* Ref.make(initialIntent);
  const signals = yield* Queue.unbounded<SupervisorSignal>();
  const resetRetryState = yield* Ref.make(false);
  // Set when a foreground wake finds a dead transport (probe failed or timed
  // out) and no replacement lease could be established: the user is actively
  // returning to the app, so the follow-up reconnect skips the first backoff
  // rung instead of sleeping.
  const wakeRecoveryFailed = yield* Ref.make(false);
  const state = yield* SubscriptionRef.make<SupervisorConnectionState>(
    !initialIntent.desired
      ? availableState(initialIntent, 0)
      : initialIntent.network === "offline"
        ? offlineState(initialIntent, 0, 0, null)
        : connectingState(initialIntent, 0, 1, null),
  );
  const session = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(Option.none());
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none());

  const clearLease = Effect.all(
    [SubscriptionRef.set(session, Option.none()), SubscriptionRef.set(prepared, Option.none())],
    { discard: true },
  );

  const setState = Effect.fn("EnvironmentSupervisor.setState")(function* (
    next: SupervisorConnectionState,
  ) {
    yield* SubscriptionRef.set(state, next);
  });

  const signal = Effect.fn("EnvironmentSupervisor.signal")(function* (next: SupervisorSignal) {
    yield* Queue.offer(signals, next);
  });

  const logManagedRelayAccountChange = Effect.logInfo(
    "Managed relay account changed; restarting the environment connection.",
  ).pipe(
    Effect.annotateLogs({
      "environment.id": target.environmentId,
      "environment.label": target.label,
    }),
  );

  const reportProgress = Effect.fn("EnvironmentSupervisor.reportProgress")(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    progress: ConnectionDriver.ConnectionDriverProgress,
  ) {
    if ("prepared" in progress) {
      yield* SubscriptionRef.set(prepared, Option.some(progress.prepared));
    }
    yield* setState(
      connectingState(yield* Ref.get(intent), generation, attempt, lastFailure, progress.stage),
    );
  });

  const establishConnection = Effect.fnUntraced(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    quiet: boolean,
  ) {
    return yield* driver.connect(entry, (progress) =>
      quiet ? Effect.void : reportProgress(attempt, generation, lastFailure, progress),
    );
  });

  const traceRelayEstablishment = (
    effect: Effect.Effect<
      ConnectionDriver.EnvironmentConnectionLease,
      ConnectionAttemptError,
      Scope.Scope
    >,
    attempt: number,
    generation: number,
    pendingRetry: Option.Option<PendingRetryTrace>,
  ) => {
    const traced = Effect.gen(function* () {
      const attemptSpan = yield* Effect.currentSpan.pipe(Effect.orDie);
      yield* annotateTarget(target);
      yield* Effect.annotateCurrentSpan({
        "connection.attempt": attempt,
        "connection.generation": generation,
        "connection.retry.failure_count": Option.match(pendingRetry, {
          onNone: () => 0,
          onSome: (retry) => retry.failureCount,
        }),
      });
      const lease = yield* effect.pipe(
        Effect.mapError(
          (error): TracedAttemptFailure => ({
            error,
            attemptSpan: Option.some(attemptSpan),
          }),
        ),
      );
      return { attemptSpan: Option.some(attemptSpan), lease };
    }).pipe(Effect.withSpan("relay.connection.attempt", { root: true }));

    return Option.match(pendingRetry, {
      onNone: () => traced,
      onSome: (retry) =>
        traced.pipe(
          Effect.linkSpans(retry.previousAttempt, {
            "connection.retry.delay_ms": retry.delayMs,
            "connection.retry.reason": retry.reason,
          }),
        ),
    }).pipe(withRelayClientTracing);
  };

  // `quiet` establishes a replacement lease behind a still-published one, so it
  // must not report progress or touch the published prepared connection.
  const establishTracedConnection = Effect.fnUntraced(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    pendingRetry: Option.Option<PendingRetryTrace>,
    quiet = false,
  ) {
    if (target._tag === "RelayConnectionTarget") {
      return yield* traceRelayEstablishment(
        establishConnection(attempt, generation, lastFailure, quiet),
        attempt,
        generation,
        pendingRetry,
      );
    }
    return yield* establishConnection(attempt, generation, lastFailure, quiet).pipe(
      Effect.map((lease) => ({
        attemptSpan: Option.none<Tracer.Span>(),
        lease,
      })),
      Effect.mapError(
        (error): TracedAttemptFailure => ({
          error,
          attemptSpan: Option.none(),
        }),
      ),
    );
  });

  const waitForEstablishmentInterrupt = Effect.fnUntraced(function* () {
    for (;;) {
      const next = yield* Queue.take(signals);
      switch (next._tag) {
        case "DisconnectRequested":
        case "RetryRequested":
          return false;
        case "NetworkChanged":
          if (next.network === "offline") {
            return false;
          }
          break;
        case "ConnectRequested":
          break;
        case "Wakeup":
          if (next.reason === "application-active-reconnect") {
            return true;
          }
          if (next.reason === "credentials-changed" && target._tag === "RelayConnectionTarget") {
            yield* logManagedRelayAccountChange;
            return false;
          }
          break;
      }
    }
  });

  const timedOutProbe = () =>
    Effect.fail(
      new ConnectionTransientError({
        reason: "timeout",
        detail: `${target.label} did not respond to a connection health check.`,
      }),
    );

  const timedOutReplacement = (): Effect.Effect<never, TracedAttemptFailure> =>
    Effect.fail({
      error: new ConnectionTransientError({
        reason: "timeout",
        detail: `${target.label} did not respond during connection setup.`,
      }),
      attemptSpan: Option.none(),
    });

  const logUnexpectedDefect = Effect.fnUntraced(function* (exit: Exit.Exit<unknown, unknown>) {
    if (
      Exit.isSuccess(exit) ||
      Cause.hasInterruptsOnly(exit.cause) ||
      exit.cause.reasons.some(Cause.isFailReason)
    ) {
      return;
    }
    const defect = exit.cause.reasons.find(Cause.isDieReason)?.defect;
    yield* Effect.logError("Connection attempt failed with an unexpected defect.").pipe(
      Effect.annotateLogs({
        "environment.id": target.environmentId,
        "environment.label": target.label,
        "cause.reason_count": exit.cause.reasons.length,
        ...safeErrorLogAttributes(defect),
      }),
    );
  });

  // Watches a published lease until it must be released or replaced. Every
  // foreground wakeup probes the live session first, because mobile operating
  // systems commonly suspend sockets without delivering a close event. A long
  // background stint ("application-active-reconnect") additionally opens a
  // replacement lease once the probe has gone unanswered for a short head
  // start (make-before-break): a healthy probe cancels it, while a dead
  // transport swaps to the replacement the moment it is ready instead of
  // paying a probe timeout followed by a connection setup. The old lease is
  // only unpublished once it is known dead (closed, or a failed/timed-out
  // probe) while the replacement is still in flight.
  const monitorConnectedLease = Effect.fnUntraced(function* (
    active: ActiveLease,
    attemptScope: Scope.Scope,
    replacementGeneration: number,
  ): Effect.fn.Return<MonitorOutcome, TracedAttemptFailure> {
    // Mutable holder (rather than closed-over lets) so the loop below sees the
    // fibers started by the helper effects.
    const inflight: {
      probe: Fiber.Fiber<void, ConnectionAttemptError> | null;
      replacementTimer: Fiber.Fiber<void> | null;
      replacement: {
        readonly fiber: Fiber.Fiber<ActiveLease, TracedAttemptFailure>;
        readonly scope: Scope.Closeable;
      } | null;
      leaseLost: boolean;
    } = { probe: null, replacementTimer: null, replacement: null, leaseLost: false };

    const withActiveSpan = (error: ConnectionAttemptError): TracedAttemptFailure => ({
      error,
      attemptSpan: active.attemptSpan,
    });

    const startProbe = Effect.fnUntraced(function* (reason: ConnectionWakeups.ConnectionWakeup) {
      inflight.probe = yield* active.lease.session.probe.pipe(
        Effect.timeoutOrElse({
          duration:
            reason === "application-active"
              ? CONNECTION_PROBE_TIMEOUT
              : MOBILE_CONNECTION_PROBE_TIMEOUT,
          orElse: timedOutProbe,
        }),
        Effect.forkChild,
      );
    });

    const startReplacement = Effect.fnUntraced(function* () {
      const scope = yield* Scope.fork(attemptScope);
      const fiber = yield* establishTracedConnection(
        1,
        replacementGeneration,
        null,
        Option.none(),
        true,
      ).pipe(
        Scope.provide(scope),
        Effect.timeoutOrElse({
          duration: CONNECTION_ESTABLISHMENT_TIMEOUT,
          orElse: timedOutReplacement,
        }),
        Effect.map(
          (established): ActiveLease => ({
            lease: established.lease,
            scope,
            attemptSpan: established.attemptSpan,
          }),
        ),
        Effect.forkChild,
      );
      inflight.replacement = { fiber, scope };
    });

    const stopProbe = Effect.suspend(() => {
      const current = inflight.probe;
      inflight.probe = null;
      return current === null ? Effect.void : Fiber.interrupt(current);
    });

    const stopReplacementTimer = Effect.suspend(() => {
      const current = inflight.replacementTimer;
      inflight.replacementTimer = null;
      return current === null ? Effect.void : Fiber.interrupt(current);
    });

    const stopReplacement = Effect.suspend(() => {
      const current = inflight.replacement;
      inflight.replacement = null;
      return current === null
        ? Effect.void
        : Fiber.interrupt(current.fiber).pipe(
            Effect.andThen(Scope.close(current.scope, Exit.void)),
          );
    });

    // The old transport is known dead but a replacement is still on its way:
    // unpublish the lease so callers stop targeting it and the UI reports the
    // reconnect honestly, then keep waiting for the replacement.
    const markLeaseLost = Effect.gen(function* () {
      if (inflight.leaseLost) {
        return;
      }
      inflight.leaseLost = true;
      yield* clearLease;
      yield* setState(
        connectingState(yield* Ref.get(intent), replacementGeneration - 1, 1, null, "opening"),
      );
    });

    const stopAll = stopProbe.pipe(
      Effect.andThen(stopReplacementTimer),
      Effect.andThen(stopReplacement),
    );

    const release = stopAll.pipe(Effect.as<MonitorOutcome>({ _tag: "Release" }));

    // Give up on this wake: the transport is dead and no replacement made it,
    // so the follow-up attempt must not sleep a backoff rung.
    const giveUp = (cause: Cause.Cause<TracedAttemptFailure>) =>
      Ref.set(wakeRecoveryFailed, true).pipe(Effect.andThen(Effect.failCause(cause)));

    for (;;) {
      const probeFiber = inflight.probe;
      const replacementTimer = inflight.replacementTimer;
      const replacementFiber = inflight.replacement?.fiber ?? null;
      const event: MonitorEvent = yield* Effect.raceAllFirst([
        Queue.take(signals).pipe(
          Effect.map((signal): MonitorEvent => ({ _tag: "Signal", signal })),
        ),
        inflight.leaseLost
          ? Effect.never
          : active.lease.session.closed.pipe(
              Effect.catch(
                (error): Effect.Effect<MonitorEvent> => Effect.succeed({ _tag: "Closed", error }),
              ),
            ),
        probeFiber === null
          ? Effect.never
          : Fiber.await(probeFiber).pipe(
              Effect.map((exit): MonitorEvent => ({ _tag: "ProbeSettled", exit })),
            ),
        replacementTimer === null
          ? Effect.never
          : Fiber.await(replacementTimer).pipe(Effect.as<MonitorEvent>({ _tag: "ReplacementDue" })),
        replacementFiber === null
          ? Effect.never
          : Fiber.await(replacementFiber).pipe(
              Effect.map((exit): MonitorEvent => ({ _tag: "ReplacementSettled", exit })),
            ),
      ]);
      // The signals queue is raced against the other arms, so a disconnect,
      // explicit retry or offline transition that settled in the same tick as
      // another event could be consumed without being seen; the refs behind
      // them are authoritative, so re-check them after every event.
      const currentIntent = yield* Ref.get(intent);
      if (
        !currentIntent.desired ||
        currentIntent.network === "offline" ||
        (yield* Ref.get(resetRetryState))
      ) {
        return yield* release;
      }
      switch (event._tag) {
        case "Closed": {
          if (inflight.replacement !== null) {
            yield* stopProbe;
            yield* markLeaseLost;
            break;
          }
          yield* stopAll;
          return yield* Effect.fail(withActiveSpan(event.error));
        }
        case "ProbeSettled": {
          inflight.probe = null;
          yield* stopReplacementTimer;
          if (Exit.isSuccess(event.exit)) {
            yield* stopReplacement;
            break;
          }
          if (inflight.replacement !== null) {
            yield* markLeaseLost;
            break;
          }
          return yield* giveUp(Cause.map(event.exit.cause, withActiveSpan));
        }
        case "ReplacementDue": {
          inflight.replacementTimer = null;
          if (inflight.probe !== null && inflight.replacement === null) {
            yield* startReplacement();
          }
          break;
        }
        case "ReplacementSettled": {
          const settled = inflight.replacement;
          inflight.replacement = null;
          if (Exit.isSuccess(event.exit)) {
            yield* stopProbe;
            return { _tag: "Replace", next: event.exit.value };
          }
          if (settled !== null) {
            yield* Scope.close(settled.scope, Exit.void);
          }
          if (inflight.probe !== null) {
            // The old lease has not been ruled out yet; let the probe decide.
            break;
          }
          return yield* giveUp(event.exit.cause);
        }
        case "Signal": {
          const next = event.signal;
          switch (next._tag) {
            case "DisconnectRequested":
            case "RetryRequested":
              return yield* release;
            case "NetworkChanged":
              if (next.network === "offline") {
                return yield* release;
              }
              break;
            case "Wakeup":
              if (next.reason === "credentials-changed") {
                if (target._tag === "RelayConnectionTarget") {
                  yield* logManagedRelayAccountChange;
                  return yield* release;
                }
                break;
              }
              if (
                ConnectionWakeups.isApplicationActiveWakeup(next.reason) &&
                inflight.probe === null &&
                inflight.replacement === null &&
                !inflight.leaseLost
              ) {
                yield* startProbe(next.reason);
              }
              if (
                next.reason === "application-active-reconnect" &&
                inflight.probe !== null &&
                inflight.replacement === null &&
                inflight.replacementTimer === null
              ) {
                inflight.replacementTimer = yield* Effect.sleep(REPLACEMENT_HEAD_START).pipe(
                  Effect.forkChild,
                );
              }
              break;
            case "ConnectRequested":
              break;
          }
          break;
        }
      }
    }
  });

  const runAttempt = Effect.fnUntraced(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    pendingRetry: Option.Option<PendingRetryTrace>,
  ) {
    yield* SubscriptionRef.set(prepared, Option.none());
    const attemptScope = yield* Effect.scope;
    const leaseScope = yield* Scope.fork(attemptScope);
    const establishment = yield* Effect.raceAllFirst([
      exitUnlessInterrupted(
        establishTracedConnection(attempt, generation, lastFailure, pendingRetry).pipe(
          Scope.provide(leaseScope),
        ),
      ).pipe(
        Effect.map(
          (exit): EstablishmentEvent => ({
            _tag: "Completed",
            exit,
          }),
        ),
      ),
      waitForEstablishmentInterrupt().pipe(
        Effect.map(
          (resetRetry): EstablishmentEvent => ({
            _tag: "Interrupted",
            resetRetry,
          }),
        ),
      ),
      Effect.sleep(CONNECTION_ESTABLISHMENT_TIMEOUT).pipe(
        Effect.as<EstablishmentEvent>({ _tag: "TimedOut" }),
      ),
    ]);

    if (establishment._tag === "Interrupted") {
      return {
        _tag: "Interrupted",
        established: false,
        stable: false,
        resetRetry: establishment.resetRetry,
        generation,
        replaced: false,
      } satisfies AttemptOutcome;
    }
    if (establishment._tag === "TimedOut") {
      return {
        _tag: "Failure",
        established: false,
        stable: false,
        failure: {
          error: new ConnectionTransientError({
            reason: "timeout",
            detail: `${target.label} did not respond during connection setup.`,
          }),
          attemptSpan: Option.none(),
        },
        generation,
        replaced: false,
      } satisfies AttemptOutcome;
    }
    if (Exit.isFailure(establishment.exit)) {
      yield* logUnexpectedDefect(establishment.exit);
      return failureFromExit(target, establishment.exit, false, false, generation);
    }

    const established = establishment.exit.value;
    const currentIntent = yield* Ref.get(intent);
    if (!currentIntent.desired || currentIntent.network === "offline") {
      return {
        _tag: "Interrupted",
        established: false,
        stable: false,
        resetRetry: false,
        generation,
        replaced: false,
      } satisfies AttemptOutcome;
    }

    const publishLease = Effect.fnUntraced(function* (
      active: ActiveLease,
      leaseGeneration: number,
      leaseAttempt: number,
    ) {
      yield* SubscriptionRef.set(prepared, Option.some(active.lease.prepared));
      yield* SubscriptionRef.set(session, Option.some(active.lease.session));
      yield* setState({
        desired: true,
        network: (yield* Ref.get(intent)).network,
        phase: "connected",
        stage: null,
        attempt: leaseAttempt,
        generation: leaseGeneration,
        lastFailure: null,
        retryAt: null,
      });
    });

    let current: ActiveLease = {
      lease: established.lease,
      scope: leaseScope,
      attemptSpan: established.attemptSpan,
    };
    let currentGeneration = generation;
    let replaced = false;
    let connectedAt = yield* Clock.currentTimeMillis;
    yield* publishLease(current, currentGeneration, attempt);

    for (;;) {
      const monitorExit = yield* monitorConnectedLease(
        current,
        attemptScope,
        currentGeneration + 1,
      ).pipe(exitUnlessInterrupted);
      if (Exit.isSuccess(monitorExit)) {
        const outcome = monitorExit.value;
        if (outcome._tag === "Replace") {
          // A replacement lease is a fresh, healthy connection: publish it as
          // attempt 1 of a new generation, then release the old transport.
          const previous = current;
          current = outcome.next;
          currentGeneration += 1;
          replaced = true;
          connectedAt = yield* Clock.currentTimeMillis;
          yield* publishLease(current, currentGeneration, 1);
          yield* Scope.close(previous.scope, Exit.void);
          continue;
        }
        return {
          _tag: "Interrupted",
          established: true,
          stable: (yield* Clock.currentTimeMillis) - connectedAt >= BACKOFF_RESET_AFTER_MS,
          resetRetry: false,
          generation: currentGeneration,
          replaced,
        } satisfies AttemptOutcome;
      }
      yield* logUnexpectedDefect(monitorExit);
      const stable = (yield* Clock.currentTimeMillis) - connectedAt >= BACKOFF_RESET_AFTER_MS;
      return failureFromExit(target, monitorExit, true, stable, currentGeneration, replaced);
    }
  }, Effect.ensuring(clearLease));

  const waitForRetrySignal = Effect.fnUntraced(function* (delayMs: number) {
    return yield* Effect.raceFirst(
      Effect.sleep(delayMs).pipe(Effect.as(false)),
      Effect.gen(function* () {
        for (;;) {
          const next = yield* Queue.take(signals);
          switch (next._tag) {
            case "Wakeup":
              return ConnectionWakeups.isApplicationActiveWakeup(next.reason);
            case "ConnectRequested":
            case "DisconnectRequested":
            case "RetryRequested":
            case "NetworkChanged":
              return false;
          }
        }
      }),
    );
  });

  const waitForSignal = Queue.take(signals).pipe(
    Effect.map(
      (next) => next._tag === "Wakeup" && ConnectionWakeups.isApplicationActiveWakeup(next.reason),
    ),
  );

  const run = Effect.fnUntraced(function* () {
    let failureCount = 0;
    let generation = 0;
    let latestFailure: ConnectionAttemptError | null = null;
    let pendingRetry = Option.none<PendingRetryTrace>();
    const resetRetryLadder = () => {
      failureCount = 0;
      pendingRetry = Option.none();
    };

    for (;;) {
      if (yield* Ref.getAndSet(resetRetryState, false)) {
        failureCount = 0;
        latestFailure = null;
        pendingRetry = Option.none();
      }
      const currentIntent = yield* Ref.get(intent);
      if (!currentIntent.desired) {
        resetRetryLadder();
        latestFailure = null;
        yield* clearLease;
        yield* setState(availableState(currentIntent, generation));
        yield* waitForSignal;
        continue;
      }
      if (currentIntent.network === "offline") {
        yield* clearLease;
        yield* setState(offlineState(currentIntent, generation, failureCount + 1, latestFailure));
        const applicationActivated = yield* waitForSignal;
        if (applicationActivated) {
          resetRetryLadder();
        }
        continue;
      }

      let attempt = failureCount + 1;
      const nextGeneration = generation + 1;
      const outcome: AttemptOutcome = yield* Effect.scoped(
        runAttempt(attempt, nextGeneration, latestFailure, pendingRetry),
      );
      // Consumed on every iteration so a stale marker can never leak into a
      // later, unrelated failure.
      const failedWakeRecovery = yield* Ref.getAndSet(wakeRecoveryFailed, false);
      if (outcome.established) {
        generation = outcome.generation;
        // A replacement lease during the attempt was a successful reconnect,
        // so the ladder restarts from there just like a fresh attempt would.
        if (outcome.stable || outcome.replaced) {
          resetRetryLadder();
          latestFailure = null;
        }
        if (outcome.replaced) {
          attempt = 1;
        }
      }
      if (outcome._tag === "Interrupted") {
        if (outcome.resetRetry) {
          resetRetryLadder();
        }
        continue;
      }

      const attemptSpan: Option.Option<Tracer.Span> = outcome.failure.attemptSpan;
      const error: ConnectionAttemptError = outcome.failure.error;
      latestFailure = error;
      if (error._tag === "ConnectionBlockedError") {
        const blockedIntent = yield* Ref.get(intent);
        yield* setState({
          desired: blockedIntent.desired,
          network: blockedIntent.network,
          phase: "blocked",
          stage: null,
          attempt,
          generation,
          lastFailure: error,
          retryAt: null,
        });
        const applicationActivated = yield* waitForSignal;
        if (applicationActivated) {
          resetRetryLadder();
        }
        continue;
      }

      if (failedWakeRecovery || (outcome.established && outcome.stable)) {
        // A dead transport found while the user is returning to the app, or a
        // connection that had been healthy for a while and just dropped (a
        // suspended phone whose socket the peer closed, a laptop waking up):
        // reconnect immediately instead of sleeping the first backoff rung,
        // and do not present the drop as a failed connection. Only this first
        // attempt skips the ladder; if it fails too, normal backoff resumes.
        resetRetryLadder();
        latestFailure = null;
        yield* setState(connectingState(yield* Ref.get(intent), generation, 1, null));
        continue;
      }

      failureCount += 1;
      const delayMs = yield* withRetryJitter(retryDelayMs(failureCount - 1));
      pendingRetry = Option.map(attemptSpan, (previousAttempt) => ({
        previousAttempt,
        failureCount,
        delayMs,
        reason: error.reason,
      }));
      const failedIntent = yield* Ref.get(intent);
      yield* setState({
        desired: failedIntent.desired,
        network: failedIntent.network,
        phase: "backoff",
        stage: null,
        attempt,
        generation,
        lastFailure: error,
        retryAt: (yield* Clock.currentTimeMillis) + delayMs,
      });
      const applicationActivated = yield* waitForRetrySignal(delayMs);
      if (applicationActivated) {
        resetRetryLadder();
      }
    }
  });

  yield* connectivity.changes.pipe(
    Stream.runForEach((network) =>
      Ref.modify(intent, (current) =>
        current.network === network ? [false, current] : ([true, { ...current, network }] as const),
      ).pipe(
        Effect.flatMap((changed) =>
          changed ? signal({ _tag: "NetworkChanged", network }) : Effect.void,
        ),
      ),
    ),
    Effect.forkScoped,
  );
  yield* wakeups.changes.pipe(
    Stream.runForEach((reason) => signal({ _tag: "Wakeup", reason })),
    Effect.forkScoped,
  );
  yield* run().pipe(Effect.forkScoped);

  const connect = Ref.update(intent, (current) => ({
    ...current,
    desired: true,
  })).pipe(
    Effect.andThen(signal({ _tag: "ConnectRequested" })),
    Effect.withSpan("EnvironmentSupervisor.connect"),
  );

  const disconnect = Ref.update(intent, (current) => ({
    ...current,
    desired: false,
  })).pipe(
    Effect.andThen(signal({ _tag: "DisconnectRequested" })),
    Effect.withSpan("EnvironmentSupervisor.disconnect"),
  );

  const retryNow = Ref.set(resetRetryState, true).pipe(
    Effect.andThen(signal({ _tag: "RetryRequested" })),
    Effect.withSpan("EnvironmentSupervisor.retryNow"),
  );

  yield* Effect.addFinalizer(() => Queue.shutdown(signals).pipe(Effect.andThen(clearLease)));

  return EnvironmentSupervisor.of({
    target,
    state,
    session,
    prepared,
    connect,
    disconnect,
    retryNow,
  });
});

export const layer = (
  entry: ConnectionCatalogEntry,
  options?: EnvironmentSupervisorOptions,
): Layer.Layer<
  EnvironmentSupervisor,
  never,
  | Connectivity.Connectivity
  | ConnectionDriver.ConnectionDriver
  | ConnectionWakeups.ConnectionWakeups
> => Layer.effect(EnvironmentSupervisor, make(entry, options));
