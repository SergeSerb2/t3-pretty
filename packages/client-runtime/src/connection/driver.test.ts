import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { type ConnectionCatalogEntry, type ConnectionRoute } from "./catalog.ts";
import { connectOverRoutes, type EnvironmentConnectionLease } from "./driver.ts";
import { PrimaryConnectionTarget, RelayConnectionTarget } from "./model.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const RELAY_ROUTE: ConnectionRoute = {
  target: new RelayConnectionTarget({ environmentId: TARGET.environmentId, label: TARGET.label }),
  profile: Option.none(),
};
const ENTRY: ConnectionCatalogEntry = {
  target: TARGET,
  profile: Option.none(),
  enabled: true,
  alternateRoutes: [RELAY_ROUTE],
};
const LEASE: EnvironmentConnectionLease = {
  prepared: {
    environmentId: TARGET.environmentId,
    label: TARGET.label,
    httpBaseUrl: TARGET.httpBaseUrl,
    socketUrl: "wss://environment.example.test/ws",
    httpAuthorization: null,
    target: TARGET,
  },
  session: {
    client: {} as WsRpcProtocolClient,
    initialConfig: Effect.never,
    subscribeServerConfig: () => {
      throw new Error("Not used by route tests.");
    },
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  },
};

describe("ConnectionDriver.connectOverRoutes", () => {
  it.effect("cancels unused route checks as soon as a route connects", () =>
    Effect.gen(function* () {
      const fallbackStarted = yield* Deferred.make<void>();
      const fallbackCancelled = yield* Ref.make(false);
      const lease = yield* connectOverRoutes(
        ENTRY,
        (route) =>
          route.target === TARGET
            ? Deferred.await(fallbackStarted).pipe(Effect.as("answered" as const))
            : Effect.acquireUseRelease(
                Deferred.succeed(fallbackStarted, undefined),
                () => Effect.never,
                () => Ref.set(fallbackCancelled, true),
              ),
        () => Effect.succeed(LEASE),
      );

      expect(lease).toBe(LEASE);
      expect(yield* Ref.get(fallbackCancelled)).toBe(true);
    }),
  );
});
