import { EnvironmentId } from "@t3tools/contracts";
import type {
  RelayClientEnvironmentRecord,
  RelayEnvironmentStatusResponse,
} from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import * as ManagedRelay from "./managedRelay.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as Connectivity from "../connection/connectivity.ts";
import { ConnectionBlockedError, type NetworkStatus } from "../connection/model.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import * as RelayEnvironmentDiscovery from "./discovery.ts";
import { NETWORK_BLOCKING_HINT } from "../errors/network.ts";

const environments = [
  {
    environmentId: EnvironmentId.make("environment-1"),
    label: "Environment One",
    endpoint: {
      httpBaseUrl: "https://one.example.test",
      wsBaseUrl: "wss://one.example.test",
      providerKind: "cloudflare_tunnel",
    },
    linkedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    environmentId: EnvironmentId.make("environment-2"),
    label: "Environment Two",
    endpoint: {
      httpBaseUrl: "https://two.example.test",
      wsBaseUrl: "wss://two.example.test",
      providerKind: "cloudflare_tunnel",
    },
    linkedAt: "2026-06-01T00:00:00.000Z",
  },
] satisfies ReadonlyArray<RelayClientEnvironmentRecord>;

function status(
  environment: RelayClientEnvironmentRecord,
  value: "online" | "offline",
): RelayEnvironmentStatusResponse {
  return {
    environmentId: environment.environmentId,
    endpoint: environment.endpoint,
    status: value,
    checkedAt: "2026-06-01T00:00:00.000Z",
  };
}

const makeHarness = Effect.fn("RelayDiscoveryTest.makeHarness")(function* () {
  const networkStatus = yield* SubscriptionRef.make<NetworkStatus>("online");
  const listCalls = yield* Ref.make(0);
  const interruptedListCalls = yield* Ref.make(0);
  const statusCalls = yield* Ref.make(0);
  const interruptedStatusCalls = yield* Ref.make(0);
  const listedEnvironments =
    yield* Ref.make<ReadonlyArray<RelayClientEnvironmentRecord>>(environments);
  const listFailure = yield* Ref.make<ManagedRelay.ManagedRelayClientError | null>(null);
  const listBarrier = yield* Ref.make<Deferred.Deferred<void> | null>(null);
  const firstListCall = yield* Deferred.make<void>();
  const blockedListCall = yield* Deferred.make<void>();
  const secondListCall = yield* Deferred.make<void>();
  const clerkToken = yield* Ref.make<string | null>("clerk-token");
  const tokenBarrier = yield* Ref.make<Deferred.Deferred<void> | null>(null);
  const blockedTokenRead = yield* Deferred.make<void>();
  const interruptedTokenReads = yield* Ref.make(0);
  const sessionIdentity = { accountId: "account-1" };
  const wakeups = yield* SubscriptionRef.make<{
    readonly sequence: number;
    readonly reason: "application-active" | "credentials-changed";
  }>({
    sequence: 0,
    reason: "application-active",
  });
  const statusRequests = yield* Ref.make(
    new Map<
      string,
      Deferred.Deferred<RelayEnvironmentStatusResponse, ManagedRelay.ManagedRelayClientError>
    >(),
  );
  for (const environment of environments) {
    const request = yield* Deferred.make<
      RelayEnvironmentStatusResponse,
      ManagedRelay.ManagedRelayClientError
    >();
    yield* Ref.update(statusRequests, (current) => {
      const next = new Map(current);
      next.set(environment.environmentId, request);
      return next;
    });
  }

  const client = ManagedRelay.ManagedRelayClient.of({
    relayUrl: "https://relay.example.test",
    listEnvironments: () =>
      Effect.gen(function* () {
        const count = yield* Ref.updateAndGet(listCalls, (current) => current + 1);
        yield* Deferred.succeed(firstListCall, undefined);
        if (count >= 2) {
          yield* Deferred.succeed(secondListCall, undefined);
        }
        const failure = yield* Ref.get(listFailure);
        if (failure) {
          return yield* failure;
        }
        const barrier = yield* Ref.get(listBarrier);
        if (barrier !== null) {
          yield* Deferred.succeed(blockedListCall, undefined);
          yield* Deferred.await(barrier);
        }
        return yield* Ref.get(listedEnvironments);
      }).pipe(Effect.onInterrupt(() => Ref.update(interruptedListCalls, (count) => count + 1))),
    getEnvironmentStatus: ({ environmentId }) =>
      Ref.update(statusCalls, (current) => current + 1).pipe(
        Effect.andThen(Ref.get(statusRequests)),
        Effect.flatMap((requests) => Deferred.await(requests.get(environmentId)!)),
        Effect.onInterrupt(() => Ref.update(interruptedStatusCalls, (count) => count + 1)),
      ),
    listDevices: () => Effect.die("unused"),
    createEnvironmentLinkChallenge: () => Effect.die("unused"),
    linkEnvironment: () => Effect.die("unused"),
    unlinkEnvironment: () => Effect.die("unused"),
    connectEnvironment: () => Effect.die("unused"),
    registerDevice: () => Effect.die("unused"),
    unregisterDevice: () => Effect.die("unused"),
    registerLiveActivity: () => Effect.die("unused"),
    getAgentActivitySnapshot: () => Effect.die("unused"),
    resetTokenCache: Effect.void,
  } satisfies ManagedRelay.ManagedRelayClient["Service"]);
  const connectivity = Connectivity.Connectivity.of({
    status: SubscriptionRef.get(networkStatus),
    // Drop the SubscriptionRef replay: production Connectivity.changes only
    // emits on real online/offline transitions.
    changes: SubscriptionRef.changes(networkStatus).pipe(Stream.drop(1)),
  });
  const layer = RelayEnvironmentDiscovery.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ManagedRelay.ManagedRelayClient, client),
        Layer.succeed(
          ClientCapabilities.CloudSession,
          ClientCapabilities.CloudSession.of({
            identity: Ref.get(clerkToken).pipe(
              Effect.map((token) =>
                token === null ? Option.none() : Option.some(sessionIdentity),
              ),
            ),
            clerkToken: Effect.gen(function* () {
              const barrier = yield* Ref.get(tokenBarrier);
              if (barrier !== null) {
                yield* Deferred.succeed(blockedTokenRead, undefined);
                yield* Deferred.await(barrier);
              }
              return yield* Ref.get(clerkToken).pipe(
                Effect.filterOrFail(
                  (token) => token !== null,
                  () =>
                    new ConnectionBlockedError({
                      reason: "authentication",
                      detail: "Signed out.",
                    }),
                ),
              );
            }).pipe(
              Effect.onInterrupt(() => Ref.update(interruptedTokenReads, (count) => count + 1)),
            ),
          }),
        ),
        Layer.succeed(Connectivity.Connectivity, connectivity),
        Layer.succeed(
          ConnectionWakeups.ConnectionWakeups,
          ConnectionWakeups.ConnectionWakeups.of({
            changes: SubscriptionRef.changes(wakeups).pipe(
              Stream.drop(1),
              Stream.map((event) => event.reason),
            ),
          }),
        ),
      ),
    ),
  );

  return {
    layer,
    listCalls,
    interruptedListCalls,
    statusCalls,
    interruptedStatusCalls,
    listedEnvironments,
    listFailure,
    listBarrier,
    firstListCall,
    blockedListCall,
    clerkToken,
    tokenBarrier,
    blockedTokenRead,
    interruptedTokenReads,
    networkStatus,
    secondListCall,
    statusRequests,
    wake: (reason: "application-active" | "credentials-changed") =>
      SubscriptionRef.update(wakeups, (event) => ({
        sequence: event.sequence + 1,
        reason,
      })),
  };
});

describe("RelayEnvironmentDiscovery", () => {
  it.effect("publishes each environment status as soon as that lookup completes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const refreshFiber = yield* Effect.forkChild(discovery.refresh);

        const checking = yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter((state) => state.environments.size === 2),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );
        expect(
          [...checking.environments.values()].every((entry) => entry.availability === "checking"),
        ).toBe(true);

        const requests = yield* Ref.get(harness.statusRequests);
        yield* Deferred.succeed(
          requests.get(environments[1]!.environmentId)!,
          status(environments[1]!, "online"),
        );

        const partiallyResolved = yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter(
            (state) =>
              state.environments.get(environments[1]!.environmentId)?.availability === "online",
          ),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );
        expect(
          partiallyResolved.environments.get(environments[0]!.environmentId)?.availability,
        ).toBe("checking");

        yield* Deferred.succeed(
          requests.get(environments[0]!.environmentId)!,
          status(environments[0]!, "offline"),
        );
        yield* Fiber.join(refreshFiber);

        const complete = yield* SubscriptionRef.get(discovery.state);
        expect(complete.loaded).toBe(true);
        expect(complete.environments.get(environments[0]!.environmentId)?.availability).toBe(
          "offline",
        );
        expect(complete.refreshing).toBe(false);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("refreshes mesh membership without repeating environment status probes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const requests = yield* Ref.get(harness.statusRequests);
        yield* Deferred.succeed(
          requests.get(environments[0]!.environmentId)!,
          status(environments[0]!, "online"),
        );
        yield* Deferred.succeed(
          requests.get(environments[1]!.environmentId)!,
          status(environments[1]!, "offline"),
        );

        yield* discovery.refresh;
        expect(yield* Ref.get(harness.statusCalls)).toBe(2);

        yield* discovery.refreshCatalog;

        expect(yield* Ref.get(harness.listCalls)).toBe(2);
        expect(yield* Ref.get(harness.statusCalls)).toBe(2);
        const refreshed = yield* SubscriptionRef.get(discovery.state);
        expect(refreshed.environments.get(environments[0]!.environmentId)?.availability).toBe(
          "online",
        );
        expect(refreshed.environments.get(environments[1]!.environmentId)?.availability).toBe(
          "offline",
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect(
    "preserves discovered rows while offline and refreshes after connectivity returns",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.gen(function* () {
          const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
          const requests = yield* Ref.get(harness.statusRequests);
          for (const environment of environments) {
            yield* Deferred.succeed(
              requests.get(environment.environmentId)!,
              status(environment, "online"),
            );
          }
          yield* discovery.refresh;

          // Let the scoped connectivity subscription start before emitting, so
          // the offline/online transitions below are observed as changes.
          yield* Effect.yieldNow;

          const offlineFiber = yield* SubscriptionRef.changes(discovery.state).pipe(
            Stream.filter((state) => state.offline),
            Stream.runHead,
            Effect.forkChild,
          );
          yield* SubscriptionRef.set(harness.networkStatus, "offline");
          yield* Fiber.join(offlineFiber);
          expect((yield* SubscriptionRef.get(discovery.state)).environments.size).toBe(2);

          // Reconnect lists even inside the auto-refresh window: going offline
          // marked state.offline and left status probes stale.
          yield* SubscriptionRef.set(harness.networkStatus, "online");
          yield* Deferred.await(harness.secondListCall);
          expect(yield* Ref.get(harness.listCalls)).toBe(2);
          expect((yield* SubscriptionRef.get(discovery.state)).offline).toBe(false);
        }).pipe(Effect.provide(harness.layer));
      }),
  );

  it.effect("observes another offline transition while recovery status probes are pending", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        for (const environment of environments) {
          const requests = yield* Ref.get(harness.statusRequests);
          yield* Deferred.succeed(
            requests.get(environment.environmentId)!,
            status(environment, "online"),
          );
        }
        yield* discovery.refresh;
        yield* Effect.yieldNow;

        for (const environment of environments) {
          const request = yield* Deferred.make<
            RelayEnvironmentStatusResponse,
            ManagedRelay.ManagedRelayClientError
          >();
          yield* Ref.update(harness.statusRequests, (requests) =>
            new Map(requests).set(environment.environmentId, request),
          );
        }
        yield* SubscriptionRef.set(harness.networkStatus, "offline");
        yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter((state) => state.offline),
          Stream.runHead,
        );
        yield* SubscriptionRef.set(harness.networkStatus, "online");
        yield* Deferred.await(harness.secondListCall);
        yield* SubscriptionRef.set(harness.networkStatus, "offline");
        yield* TestClock.adjust("0 millis");

        const offline = yield* SubscriptionRef.get(discovery.state);
        expect(offline.offline).toBe(true);
        expect(offline.refreshing).toBe(false);
        expect(offline.environments.size).toBe(2);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("publishes listing failures without rejecting the refresh command", () =>
    Effect.gen(function* () {
      const networkStatus = yield* SubscriptionRef.make<NetworkStatus>("online");
      const client = ManagedRelay.ManagedRelayClient.of({
        relayUrl: "https://relay.example.test",
        listEnvironments: () =>
          Effect.fail(
            new ManagedRelay.ManagedRelayRequestTimeoutError({
              activity: "Relay environment listing",
              timeoutMs: ManagedRelay.MANAGED_RELAY_REQUEST_TIMEOUT_MS,
              traceId: null,
            }),
          ),
        getEnvironmentStatus: () => Effect.die("unused"),
        listDevices: () => Effect.die("unused"),
        createEnvironmentLinkChallenge: () => Effect.die("unused"),
        linkEnvironment: () => Effect.die("unused"),
        unlinkEnvironment: () => Effect.die("unused"),
        connectEnvironment: () => Effect.die("unused"),
        registerDevice: () => Effect.die("unused"),
        unregisterDevice: () => Effect.die("unused"),
        registerLiveActivity: () => Effect.die("unused"),
        getAgentActivitySnapshot: () => Effect.die("unused"),
        resetTokenCache: Effect.void,
      } satisfies ManagedRelay.ManagedRelayClient["Service"]);
      const layer = RelayEnvironmentDiscovery.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ManagedRelay.ManagedRelayClient, client),
            Layer.succeed(ClientCapabilities.CloudSession, {
              identity: Effect.succeedSome({ accountId: "account-1" }),
              clerkToken: Effect.succeed("clerk-token"),
            }),
            Layer.succeed(Connectivity.Connectivity, {
              status: SubscriptionRef.get(networkStatus),
              changes: SubscriptionRef.changes(networkStatus),
            }),
            Layer.succeed(
              ConnectionWakeups.ConnectionWakeups,
              ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.never }),
            ),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        yield* discovery.refresh;

        const state = yield* SubscriptionRef.get(discovery.state);
        expect(state.refreshing).toBe(false);
        expect(Option.getOrThrow(state.error)).toMatchObject({
          _tag: "ConnectionTransientError",
          reason: "timeout",
          message: `Relay environment listing timed out. ${NETWORK_BLOCKING_HINT}`,
        });
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("retains previously discovered rows when a refresh fails transiently", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const requests = yield* Ref.get(harness.statusRequests);
        for (const environment of environments) {
          yield* Deferred.succeed(
            requests.get(environment.environmentId)!,
            status(environment, "online"),
          );
        }
        yield* discovery.refresh;
        expect((yield* SubscriptionRef.get(discovery.state)).environments.size).toBe(2);

        yield* Ref.set(
          harness.listFailure,
          new ManagedRelay.ManagedRelayRequestFailedError({
            action: "list relay-managed environments",
            cause: new Error("Relay request failed."),
          }),
        );
        yield* discovery.refresh;

        const failed = yield* SubscriptionRef.get(discovery.state);
        expect(failed.environments.size).toBe(2);
        expect(failed.loaded).toBe(true);
        expect(failed.refreshing).toBe(false);
        expect(Option.isSome(failed.error)).toBe(true);

        yield* Ref.set(harness.listFailure, null);
        yield* discovery.refreshCatalog;
        const recovered = yield* SubscriptionRef.get(discovery.state);
        expect(recovered.loaded).toBe(true);
        expect(Option.isNone(recovered.error)).toBe(true);
        expect(recovered.environments.size).toBe(2);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("clears discovered rows when relay authentication fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        yield* discovery.refreshCatalog;
        yield* Ref.set(
          harness.listFailure,
          new ManagedRelay.ManagedRelayDpopKeyLoadError({
            keyStore: "indexed-db",
            cause: new Error("Proof key unavailable."),
          }),
        );
        yield* discovery.refreshCatalog;

        const rejected = yield* SubscriptionRef.get(discovery.state);
        expect(rejected.environments.size).toBe(0);
        expect(rejected.loaded).toBe(false);
        expect(Option.getOrThrow(rejected.error)).toMatchObject({
          _tag: "ConnectionBlockedError",
          reason: "authentication",
        });
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("does not retain another account's rows when its first listing fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const token = (accountId: string) =>
        `header.${btoa(JSON.stringify({ sub: accountId }))}.signature`;
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        yield* Ref.set(harness.clerkToken, token("account-1"));
        yield* discovery.refreshCatalog;
        yield* Ref.set(harness.clerkToken, token("account-2"));
        yield* Ref.set(
          harness.listFailure,
          new ManagedRelay.ManagedRelayRequestTimeoutError({
            activity: "Relay environment listing",
            timeoutMs: ManagedRelay.MANAGED_RELAY_REQUEST_TIMEOUT_MS,
            traceId: null,
          }),
        );
        yield* discovery.refreshCatalog;

        const switched = yield* SubscriptionRef.get(discovery.state);
        expect(switched.environments.size).toBe(0);
        expect(switched.loaded).toBe(false);
        expect(switched.refreshing).toBe(false);
        expect(Option.isSome(switched.error)).toBe(true);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("settles refreshing when a status sweep is interrupted", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const refreshFiber = yield* Effect.forkChild(discovery.refresh);
        yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter((state) => state.loaded),
          Stream.runHead,
        );

        yield* Fiber.interrupt(refreshFiber);

        const interrupted = yield* SubscriptionRef.get(discovery.state);
        expect(interrupted.refreshing).toBe(false);
        expect(interrupted.environments.size).toBe(2);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("shares an overlapping membership list between catalog refresh callers", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const barrier = yield* Deferred.make<void>();
      yield* Ref.set(harness.listBarrier, barrier);
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const catalogFiber = yield* Effect.forkChild(discovery.refreshCatalog);
        yield* Deferred.await(harness.firstListCall);
        const secondCatalogFiber = yield* Effect.forkChild(discovery.refreshCatalog);
        yield* Effect.yieldNow;
        const thirdCatalogFiber = yield* Effect.forkChild(discovery.refreshCatalog);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(barrier, undefined);
        yield* Fiber.join(catalogFiber);
        yield* Fiber.join(secondCatalogFiber);
        yield* Fiber.join(thirdCatalogFiber);

        expect(yield* Ref.get(harness.listCalls)).toBe(1);
        expect(yield* Ref.get(harness.statusCalls)).toBe(0);
        expect((yield* SubscriptionRef.get(discovery.state)).refreshing).toBe(false);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("re-lists after a shared refresh is interrupted before applying membership", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        yield* discovery.refreshCatalog;
        const barrier = yield* Deferred.make<void>();
        yield* Ref.set(harness.listBarrier, barrier);
        yield* Ref.set(harness.listedEnvironments, environments.slice(1));
        const first = yield* Effect.forkChild(discovery.refreshCatalog);
        yield* Deferred.await(harness.secondListCall);

        // Hold the membership write after the relay responds, as another
        // discovery state update can do. Cancellation must not publish a
        // revision that lets a queued poll reuse the old membership.
        yield* discovery.state.semaphore.take(1);
        const queued = yield* Effect.forkChild(discovery.refreshCatalog);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(barrier, undefined);
        yield* TestClock.adjust("0 millis");
        const interrupted = yield* Effect.forkChild(Fiber.interrupt(first));
        yield* TestClock.adjust("0 millis");
        yield* discovery.state.semaphore.release(1);
        yield* Fiber.join(interrupted);
        yield* Fiber.join(queued);

        expect(yield* Ref.get(harness.listCalls)).toBe(3);
        const refreshed = yield* SubscriptionRef.get(discovery.state);
        expect([...refreshed.environments.keys()]).toEqual([environments[1]!.environmentId]);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("re-lists for a full refresh requested while an older membership read is pending", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const barrier = yield* Deferred.make<void>();
      yield* Ref.set(harness.listBarrier, barrier);
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const requests = yield* Ref.get(harness.statusRequests);
        for (const environment of environments) {
          yield* Deferred.succeed(
            requests.get(environment.environmentId)!,
            status(environment, "online"),
          );
        }
        const catalogFiber = yield* Effect.forkChild(discovery.refreshCatalog);
        yield* Deferred.await(harness.firstListCall);
        const fullRefreshFiber = yield* Effect.forkChild(discovery.refresh);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(barrier, undefined);
        yield* Fiber.join(catalogFiber);
        yield* Fiber.join(fullRefreshFiber);

        expect(yield* Ref.get(harness.listCalls)).toBe(2);
        expect(yield* Ref.get(harness.statusCalls)).toBe(2);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("re-lists for a request made after the previous membership read", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const refreshFiber = yield* Effect.forkChild(discovery.refresh);
        yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter((state) => state.loaded),
          Stream.runHead,
        );
        const catalogFiber = yield* Effect.forkChild(discovery.refreshCatalog);
        yield* Effect.yieldNow;
        const requests = yield* Ref.get(harness.statusRequests);
        for (const environment of environments) {
          yield* Deferred.succeed(
            requests.get(environment.environmentId)!,
            status(environment, "online"),
          );
        }
        yield* Fiber.join(refreshFiber);
        yield* Fiber.join(catalogFiber);

        expect(yield* Ref.get(harness.listCalls)).toBe(2);
        expect(yield* Ref.get(harness.statusCalls)).toBe(2);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("refreshes proactively when credentials change before any manual refresh", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const requests = yield* Ref.get(harness.statusRequests);
        for (const environment of environments) {
          yield* Deferred.succeed(
            requests.get(environment.environmentId)!,
            status(environment, "online"),
          );
        }

        // Let the scoped wakeup subscription start before emitting, mirroring
        // a real sign-in which always happens long after service start.
        yield* Effect.yieldNow;

        // Sign-in activates the session and emits credentials-changed; the
        // list must populate without any screen having asked for a refresh.
        yield* harness.wake("credentials-changed");
        const populated = yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter(
            (state) => state.environments.size === environments.length && !state.refreshing,
          ),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        );
        expect(Option.isNone(populated.error)).toBe(true);
        expect(yield* Ref.get(harness.listCalls)).toBe(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("refreshes discovered environments when the application becomes active", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const requests = yield* Ref.get(harness.statusRequests);
        for (const environment of environments) {
          yield* Deferred.succeed(
            requests.get(environment.environmentId)!,
            status(environment, "online"),
          );
        }
        yield* discovery.refresh;
        yield* Effect.yieldNow;

        // Explicit refresh does not claim the auto-refresh window, so a wakeup
        // still lists.
        yield* harness.wake("application-active");
        yield* Deferred.await(harness.secondListCall);

        expect(yield* Ref.get(harness.listCalls)).toBe(2);
        expect((yield* SubscriptionRef.get(discovery.state)).loaded).toBe(true);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("lists on connectivity restore even when a wakeup just claimed the window", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const awaitListCalls = (expected: number) =>
        Effect.gen(function* () {
          for (let attempt = 0; attempt < 1_000; attempt++) {
            if ((yield* Ref.get(harness.listCalls)) >= expected) {
              return;
            }
            yield* Effect.yieldNow;
          }
          throw new Error(`Timed out waiting for ${expected} environment listings.`);
        });
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const requests = yield* Ref.get(harness.statusRequests);
        for (const environment of environments) {
          yield* Deferred.succeed(
            requests.get(environment.environmentId)!,
            status(environment, "online"),
          );
        }
        yield* discovery.refresh;
        yield* Effect.yieldNow;

        yield* harness.wake("application-active");
        yield* Deferred.await(harness.secondListCall);

        const offlineFiber = yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter((state) => state.offline),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* SubscriptionRef.set(harness.networkStatus, "offline");
        yield* Fiber.join(offlineFiber);

        yield* SubscriptionRef.set(harness.networkStatus, "online");
        yield* awaitListCalls(3);
        expect((yield* SubscriptionRef.get(discovery.state)).offline).toBe(false);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("coalesces rapid application-active wakeups into one refresh", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const awaitListCalls = (expected: number) =>
        Effect.gen(function* () {
          for (let attempt = 0; attempt < 1_000; attempt++) {
            if ((yield* Ref.get(harness.listCalls)) >= expected) {
              return;
            }
            yield* Effect.yieldNow;
          }
          throw new Error(`Timed out waiting for ${expected} environment listings.`);
        });
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const requests = yield* Ref.get(harness.statusRequests);
        for (const environment of environments) {
          yield* Deferred.succeed(
            requests.get(environment.environmentId)!,
            status(environment, "online"),
          );
        }
        yield* discovery.refresh;
        yield* Effect.yieldNow;

        // Explicit refresh does not claim the window. The first wakeup
        // refreshes; a second overlapping wakeup (visibilitychange racing
        // connectivity) must lose the atomic claim.
        yield* harness.wake("application-active");
        yield* harness.wake("application-active");
        yield* Deferred.await(harness.secondListCall);
        for (let attempt = 0; attempt < 100; attempt++) {
          yield* Effect.yieldNow;
        }
        expect(yield* Ref.get(harness.listCalls)).toBe(2);

        // A wakeup inside the window is dropped.
        yield* harness.wake("application-active");
        for (let attempt = 0; attempt < 100; attempt++) {
          yield* Effect.yieldNow;
        }
        expect(yield* Ref.get(harness.listCalls)).toBe(2);

        // The next wakeup after the window refreshes again.
        yield* TestClock.adjust("61 seconds");
        yield* harness.wake("application-active");
        yield* awaitListCalls(3);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("settles to a clean empty state when refreshed while signed out", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        yield* Ref.set(harness.clerkToken, null);
        yield* discovery.refresh;

        const state = yield* SubscriptionRef.get(discovery.state);
        expect(state.environments.size).toBe(0);
        expect(state.refreshing).toBe(false);
        expect(Option.isNone(state.error)).toBe(true);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("does not republish stale rows after sign-out invalidates an in-flight refresh", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const refreshFiber = yield* Effect.forkChild(discovery.refresh);
        yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter((state) => state.environments.size === environments.length),
          Stream.runHead,
        );

        yield* Ref.set(harness.clerkToken, null);
        yield* harness.wake("credentials-changed");
        yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter((state) => state.environments.size === 0),
          Stream.runHead,
        );

        const requests = yield* Ref.get(harness.statusRequests);
        for (const environment of environments) {
          yield* Deferred.succeed(
            requests.get(environment.environmentId)!,
            status(environment, "online"),
          );
        }
        yield* Fiber.join(refreshFiber);
        yield* Effect.yieldNow;

        expect((yield* SubscriptionRef.get(discovery.state)).environments.size).toBe(0);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("does not start more status probes after an account change invalidates the sweep", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const manyEnvironments = Array.from({ length: 8 }, (_, index) => ({
        ...environments[0]!,
        environmentId: EnvironmentId.make(`environment-${index + 1}`),
      }));
      yield* Ref.set(harness.listedEnvironments, manyEnvironments);
      for (const environment of manyEnvironments) {
        const request = yield* Deferred.make<
          RelayEnvironmentStatusResponse,
          ManagedRelay.ManagedRelayClientError
        >();
        yield* Ref.update(harness.statusRequests, (requests) =>
          new Map(requests).set(environment.environmentId, request),
        );
      }
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const refreshing = yield* Effect.forkChild(discovery.refresh);
        yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter((state) => state.environments.size === manyEnvironments.length),
          Stream.runHead,
        );
        yield* TestClock.adjust("0 millis");
        expect(yield* Ref.get(harness.statusCalls)).toBe(6);

        yield* Ref.set(harness.clerkToken, null);
        yield* harness.wake("credentials-changed");
        yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter((state) => state.environments.size === 0),
          Stream.runHead,
        );
        const requests = yield* Ref.get(harness.statusRequests);
        for (const environment of manyEnvironments.slice(0, 6)) {
          yield* Deferred.succeed(
            requests.get(environment.environmentId)!,
            status(environment, "online"),
          );
        }
        yield* TestClock.adjust("0 millis");

        expect(yield* Ref.get(harness.statusCalls)).toBe(6);
        yield* Fiber.join(refreshing);
        expect((yield* SubscriptionRef.get(discovery.state)).environments.size).toBe(0);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("starts the new account refresh without waiting for obsolete status requests", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        const refreshing = yield* Effect.forkChild(discovery.refresh);
        yield* SubscriptionRef.changes(discovery.state).pipe(
          Stream.filter((state) => state.environments.size === environments.length),
          Stream.runHead,
        );
        yield* TestClock.adjust("0 millis");
        expect(yield* Ref.get(harness.statusCalls)).toBe(2);

        for (const environment of environments) {
          const request = yield* Deferred.make<
            RelayEnvironmentStatusResponse,
            ManagedRelay.ManagedRelayClientError
          >();
          yield* Deferred.succeed(request, status(environment, "online"));
          yield* Ref.update(harness.statusRequests, (requests) =>
            new Map(requests).set(environment.environmentId, request),
          );
        }
        yield* Ref.set(harness.clerkToken, "replacement-token");
        yield* harness.wake("credentials-changed");
        yield* TestClock.adjust("0 millis");

        expect(yield* Ref.get(harness.listCalls)).toBe(2);
        expect(yield* Ref.get(harness.interruptedStatusCalls)).toBe(2);
        yield* Fiber.join(refreshing);
        const current = yield* SubscriptionRef.get(discovery.state);
        expect(current.refreshing).toBe(false);
        expect([...current.environments.values()].map((entry) => entry.availability)).toEqual([
          "online",
          "online",
        ]);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect(
    "starts the new account refresh without waiting for an obsolete membership request",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const barrier = yield* Deferred.make<void>();
        yield* Ref.set(harness.listBarrier, barrier);
        yield* Effect.gen(function* () {
          const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
          const requests = yield* Ref.get(harness.statusRequests);
          for (const environment of environments) {
            yield* Deferred.succeed(
              requests.get(environment.environmentId)!,
              status(environment, "online"),
            );
          }
          const refreshing = yield* Effect.forkChild(discovery.refreshCatalog);
          yield* Deferred.await(harness.blockedListCall);

          yield* Ref.set(harness.listBarrier, null);
          yield* Ref.set(harness.clerkToken, "replacement-token");
          yield* harness.wake("credentials-changed");
          yield* TestClock.adjust("0 millis");

          expect(yield* Ref.get(harness.listCalls)).toBe(2);
          expect(yield* Ref.get(harness.interruptedListCalls)).toBe(1);
          yield* Fiber.join(refreshing);
          const current = yield* SubscriptionRef.get(discovery.state);
          expect(current.refreshing).toBe(false);
          expect(current.loaded).toBe(true);
          expect(current.environments.size).toBe(2);
        }).pipe(Effect.provide(harness.layer));
      }),
  );

  it.effect(
    "starts the new account refresh without waiting for an obsolete session token read",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const barrier = yield* Deferred.make<void>();
        yield* Ref.set(harness.tokenBarrier, barrier);
        yield* Effect.gen(function* () {
          const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
          const requests = yield* Ref.get(harness.statusRequests);
          for (const environment of environments) {
            yield* Deferred.succeed(
              requests.get(environment.environmentId)!,
              status(environment, "online"),
            );
          }
          const refreshing = yield* Effect.forkChild(discovery.refreshCatalog);
          yield* Deferred.await(harness.blockedTokenRead);

          yield* Ref.set(harness.tokenBarrier, null);
          yield* Ref.set(harness.clerkToken, "replacement-token");
          yield* harness.wake("credentials-changed");
          yield* TestClock.adjust("0 millis");

          expect(yield* Ref.get(harness.listCalls)).toBe(1);
          expect(yield* Ref.get(harness.interruptedTokenReads)).toBe(1);
          yield* Fiber.join(refreshing);
          const current = yield* SubscriptionRef.get(discovery.state);
          expect(current.refreshing).toBe(false);
          expect(current.loaded).toBe(true);
        }).pipe(Effect.provide(harness.layer));
      }),
  );

  it.effect("settles a stalled session token read and permits a later refresh", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const discovery = yield* RelayEnvironmentDiscovery.RelayEnvironmentDiscovery;
        yield* discovery.refreshCatalog;
        const barrier = yield* Deferred.make<void>();
        yield* Ref.set(harness.tokenBarrier, barrier);
        const refreshing = yield* Effect.forkChild(discovery.refreshCatalog);
        yield* Deferred.await(harness.blockedTokenRead);
        yield* TestClock.adjust("30 seconds");

        const stalled = yield* SubscriptionRef.get(discovery.state);
        expect(stalled.refreshing).toBe(false);
        expect(stalled.environments.size).toBe(2);
        expect(Option.getOrThrow(stalled.error)).toMatchObject({
          _tag: "ConnectionTransientError",
          reason: "timeout",
        });
        expect(yield* Ref.get(harness.interruptedTokenReads)).toBe(1);
        yield* Fiber.join(refreshing);

        yield* Ref.set(harness.tokenBarrier, null);
        yield* discovery.refreshCatalog;
        const recovered = yield* SubscriptionRef.get(discovery.state);
        expect(recovered.refreshing).toBe(false);
        expect(Option.isNone(recovered.error)).toBe(true);
        expect(yield* Ref.get(harness.listCalls)).toBe(2);
      }).pipe(Effect.provide(harness.layer));
    }),
  );
});
