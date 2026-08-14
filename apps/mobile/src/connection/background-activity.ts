import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { EnvironmentRpcSubscriptionObserver, request } from "@t3tools/client-runtime/rpc";
import {
  type BackgroundScope,
  type ClientActivityReportInput,
  type EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AppState, type AppStateStatus } from "react-native";

import * as MobileStorage from "../persistence/mobile-storage";
import {
  observeMobileBackgroundActivitySubscription,
  onRetainedMobileBackgroundScopesChange,
  retainedMobileBackgroundScopes,
} from "./background-activity-scopes";

const REPORT_INTERVAL_MS = 25_000;
const LEASE_TTL_MS = 45_000;
const BASELINE_SCOPES: ReadonlyArray<BackgroundScope> = [{ type: "provider-status" }];

function normalizeAppState(
  state: AppStateStatus,
): NonNullable<ClientActivityReportInput["appState"]> {
  if (state === "active" || state === "inactive" || state === "background") return state;
  return "unknown";
}

// Stable content key for a report. observedAt is stamped fresh on every pass
// and the environment id keys the tracker map, so neither takes part.
export function clientActivityReportSignature(input: ClientActivityReportInput): string {
  const { environmentId: _environmentId, observedAt: _observedAt, ...content } = input;
  return JSON.stringify(content);
}

/**
 * Dedupes the per-environment heartbeat against the last report the server
 * ACCEPTED: an identical report carries no new lease content, so skipping it
 * lets an idle environment stop waking the radio. A failed send records
 * nothing, so the next interval retries (fail-fast when disconnected is
 * unchanged).
 */
export function createClientActivityReportTracker() {
  const lastAcceptedSignatureByEnvironment = new Map<EnvironmentId, string>();
  return {
    shouldReport(environmentId: EnvironmentId, signature: string): boolean {
      return lastAcceptedSignatureByEnvironment.get(environmentId) !== signature;
    },
    markAccepted(environmentId: EnvironmentId, signature: string): void {
      lastAcceptedSignatureByEnvironment.set(environmentId, signature);
    },
    // A re-registered environment gets a fresh server-side lease state, so its
    // first report must go out even when the content matches what a previous
    // registration last accepted.
    prune(environmentIds: ReadonlySet<EnvironmentId>): void {
      for (const environmentId of lastAcceptedSignatureByEnvironment.keys()) {
        if (!environmentIds.has(environmentId)) {
          lastAcceptedSignatureByEnvironment.delete(environmentId);
        }
      }
    },
  };
}

export const mobileBackgroundActivityObserverLayer = Layer.succeed(
  EnvironmentRpcSubscriptionObserver,
  EnvironmentRpcSubscriptionObserver.of({
    observe: observeMobileBackgroundActivitySubscription,
  }),
);

export const mobileBackgroundActivityReporterLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* EnvironmentRegistry;
    const storage = yield* MobileStorage.MobileStorage;
    const clientId = yield* storage.loadOrCreateAgentAwarenessDeviceId.pipe(
      Effect.map((deviceId) => `mobile-${deviceId}`),
      Effect.orElseSucceed(() => "ephemeral-mobile-client"),
    );
    const reportRequests = yield* Queue.sliding<void>(1);
    const requestReport = () => Queue.offerUnsafe(reportRequests, undefined);
    const reportTracker = createClientActivityReportTracker();
    let appState = AppState.currentState;

    const report = Effect.gen(function* () {
      const observedAtMs = yield* Clock.currentTimeMillis;
      const active = appState === "active";
      const entries = yield* SubscriptionRef.get(registry.entries);
      yield* Effect.forEach(
        entries.keys(),
        (environmentId) => {
          const input: ClientActivityReportInput = {
            environmentId: environmentId as EnvironmentId,
            clientId,
            clientKind: "mobile",
            visible: active,
            focused: active,
            recentlyInteracted: active,
            appState: normalizeAppState(appState),
            scopes: [
              ...BASELINE_SCOPES,
              ...retainedMobileBackgroundScopes(environmentId as EnvironmentId),
            ],
            ttlMs: LEASE_TTL_MS,
            observedAt: DateTime.makeUnsafe(observedAtMs),
          };
          const signature = clientActivityReportSignature(input);
          if (!reportTracker.shouldReport(environmentId as EnvironmentId, signature)) {
            return Effect.void;
          }
          return registry
            .run(environmentId, request(WS_METHODS.serverReportClientActivity, input))
            .pipe(
              Effect.tap(() =>
                Effect.sync(() =>
                  reportTracker.markAccepted(environmentId as EnvironmentId, signature),
                ),
              ),
              Effect.ignore,
            );
        },
        { concurrency: "unbounded", discard: true },
      );
    }).pipe(Effect.withSpan("mobile.backgroundActivity.report"));

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const removeScopeListener = onRetainedMobileBackgroundScopesChange(requestReport);
        const subscription = AppState.addEventListener("change", (nextState) => {
          appState = nextState;
          requestReport();
        });
        return { removeScopeListener, subscription };
      }),
      ({ removeScopeListener, subscription }) =>
        Effect.sync(() => {
          removeScopeListener();
          subscription.remove();
        }),
    );
    yield* SubscriptionRef.changes(registry.entries).pipe(
      Stream.runForEach((entries) =>
        Effect.sync(() => {
          reportTracker.prune(new Set(entries.keys()));
          requestReport();
        }),
      ),
      Effect.forkScoped,
    );
    yield* Stream.fromQueue(reportRequests).pipe(
      Stream.debounce("250 millis"),
      Stream.runForEach(() => report),
      Effect.forkScoped,
    );
    yield* Effect.sync(requestReport).pipe(
      Effect.repeat(Schedule.spaced(`${REPORT_INTERVAL_MS} millis`)),
      Effect.forkScoped,
    );
  }),
);
