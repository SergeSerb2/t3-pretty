import { EnvironmentId } from "@t3tools/contracts";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";

import * as RelayEnvironmentDiscovery from "../relay/discovery.ts";
import { createRelayEnvironmentDiscoveryAtoms } from "./relayDiscovery.ts";

const ENVIRONMENT: RelayClientEnvironmentRecord = {
  environmentId: EnvironmentId.make("newly-linked"),
  label: "Newly linked environment",
  endpoint: {
    httpBaseUrl: "https://environment.example.test",
    wsBaseUrl: "wss://environment.example.test",
    providerKind: "cloudflare_tunnel",
  },
  linkedAt: "2026-10-13T00:00:00.000Z",
};

const makeHarness = Effect.gen(function* () {
  const firstStarted = yield* Deferred.make<void>();
  const releaseFirst = yield* Deferred.make<void>();
  const membership = yield* Ref.make<ReadonlyArray<RelayClientEnvironmentRecord>>([]);
  const listCalls = yield* Ref.make(0);
  const state = yield* SubscriptionRef.make(
    RelayEnvironmentDiscovery.EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE,
  );
  const list = Effect.gen(function* () {
    const call = yield* Ref.updateAndGet(listCalls, (count) => count + 1);
    const snapshot = yield* Ref.get(membership);
    if (call === 1) {
      yield* Deferred.succeed(firstStarted, undefined);
      yield* Deferred.await(releaseFirst);
    }
    yield* SubscriptionRef.update(state, (current) => ({
      ...current,
      loaded: true,
      environments: new Map(
        snapshot.map((environment) => [
          environment.environmentId,
          {
            environment,
            availability: "checking" as const,
            status: Option.none(),
            error: Option.none(),
          },
        ]),
      ),
    }));
  });
  const runtime = Atom.runtime(
    Layer.succeed(RelayEnvironmentDiscovery.RelayEnvironmentDiscovery, {
      state,
      refresh: list,
      refreshCatalog: list,
    }),
  );
  const registry = yield* Effect.acquireRelease(
    Effect.sync(() => AtomRegistry.make()),
    (current) => Effect.sync(() => current.dispose()),
  );
  return {
    ...createRelayEnvironmentDiscoveryAtoms(runtime),
    registry,
    state,
    listCalls,
    firstStarted,
    releaseFirst,
    membership,
  };
});

describe("relay discovery commands", () => {
  it.effect.each(["link", "unlink"] as const)(
    "lists after %s while coalescing refreshes queued behind an older list",
    (mutation) =>
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        yield* Ref.set(harness.membership, mutation === "link" ? [] : [ENVIRONMENT]);
        const olderList = harness.refresh.run(harness.registry, undefined);
        yield* Deferred.await(harness.firstStarted);
        yield* Ref.set(harness.membership, mutation === "link" ? [ENVIRONMENT] : []);

        const afterLink = harness.refresh.run(harness.registry, undefined);
        const queued = Array.from({ length: 20 }, () =>
          harness.refresh.run(harness.registry, undefined),
        );
        expect(yield* Ref.get(harness.listCalls)).toBe(1);
        yield* Deferred.succeed(harness.releaseFirst, undefined);
        const results = yield* Effect.promise(() => Promise.all([olderList, afterLink, ...queued]));

        expect(results.every((result) => result._tag === "Success")).toBe(true);
        expect(yield* Ref.get(harness.listCalls)).toBe(2);
        expect(Array.from((yield* SubscriptionRef.get(harness.state)).environments.keys())).toEqual(
          mutation === "link" ? [ENVIRONMENT.environmentId] : [],
        );
      }),
  );

  it.effect("keeps concurrent membership polls on one active list", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const active = harness.refreshCatalog.run(harness.registry, undefined);
      yield* Deferred.await(harness.firstStarted);
      const polls = Array.from({ length: 20 }, () =>
        harness.refreshCatalog.run(harness.registry, undefined),
      );
      yield* Deferred.succeed(harness.releaseFirst, undefined);
      const results = yield* Effect.promise(() => Promise.all([active, ...polls]));

      expect(results.every((result) => result._tag === "Success")).toBe(true);
      expect(yield* Ref.get(harness.listCalls)).toBe(1);
    }),
  );
});
