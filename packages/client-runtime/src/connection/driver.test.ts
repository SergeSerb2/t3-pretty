import { EnvironmentId, ORCHESTRATION_PROTOCOL_VERSION } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import { type ConnectionCatalogEntry, type ConnectionRoute } from "./catalog.ts";
import { connectOverRoutes, type EnvironmentConnectionLease } from "./driver.ts";
import * as ConnectionDriver from "./driver.ts";
import * as ConnectionResolver from "./resolver.ts";
import { ConnectionBlockedError, PrimaryConnectionTarget, RelayConnectionTarget } from "./model.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import * as RpcSession from "../rpc/session.ts";

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
  it.effect(
    "connects a compatible fallback when the preferred runtime uses an older protocol",
    () =>
      Effect.gen(function* () {
        const attempts: string[] = [];
        const fallbackLease = {
          ...LEASE,
          prepared: { ...LEASE.prepared, target: RELAY_ROUTE.target },
        };
        const lease = yield* connectOverRoutes(
          ENTRY,
          () => Effect.succeed("unchecked"),
          (route) =>
            Effect.sync(() => attempts.push(route.target._tag)).pipe(
              Effect.andThen(
                route.target === TARGET
                  ? Effect.fail(
                      new ConnectionBlockedError({
                        reason: "unsupported",
                        detail: "Update the preferred preview runtime.",
                      }),
                    )
                  : Effect.succeed(fallbackLease),
              ),
            ),
        );

        expect(lease).toBe(fallbackLease);
        expect(attempts).toEqual(["PrimaryConnectionTarget", "RelayConnectionTarget"]);
      }),
  );

  it.effect(
    "keeps a fallback authentication failure instead of disabling all routes as unsupported",
    () =>
      Effect.gen(function* () {
        const authentication = new ConnectionBlockedError({
          reason: "authentication",
          detail: "Sign in to T3 Connect.",
        });
        const error = yield* connectOverRoutes(
          ENTRY,
          () => Effect.succeed("unchecked"),
          (route) =>
            Effect.fail(
              route.target === TARGET
                ? new ConnectionBlockedError({
                    reason: "unsupported",
                    detail: "Update the preferred preview runtime.",
                  })
                : authentication,
            ),
        ).pipe(Effect.flip);

        expect(error).toBe(authentication);
      }),
  );

  it.effect("reports unsupported when every saved runtime uses an incompatible protocol", () =>
    Effect.gen(function* () {
      const unsupported = new ConnectionBlockedError({
        reason: "unsupported",
        detail: "Update this server.",
      });
      let attempts = 0;
      const error = yield* connectOverRoutes(
        ENTRY,
        () => Effect.succeed("unchecked"),
        () => Effect.sync(() => (attempts += 1)).pipe(Effect.andThen(Effect.fail(unsupported))),
      ).pipe(Effect.flip);

      expect(error).toBe(unsupported);
      expect(attempts).toBe(2);
    }),
  );

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

describe("ConnectionDriver.preflight", () => {
  it.effect("cancels stalled route authorization within the connection setup deadline", () =>
    Effect.gen(function* () {
      const authorizing = yield* Deferred.make<void>();
      const cancelled = yield* Ref.make(false);
      const http = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              environmentId: TARGET.environmentId,
              label: TARGET.label,
              platform: { os: "linux", arch: "x64" },
              serverVersion: "0.0.0-test",
              orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
              capabilities: {},
            }),
          ),
        ),
      );
      const driver = yield* ConnectionDriver.ConnectionDriver.pipe(
        Effect.provide(
          ConnectionDriver.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(HttpClient.HttpClient, http),
                Layer.succeed(ConnectionResolver.ConnectionResolver, {
                  prepare: () =>
                    Effect.acquireUseRelease(
                      Deferred.succeed(authorizing, undefined),
                      () => Effect.never,
                      () => Ref.set(cancelled, true),
                    ),
                  prepareForUpdate: () => Effect.die("unused"),
                }),
                Layer.succeed(RpcSession.RpcSessionFactory, {
                  connect: () => Effect.die("unused"),
                }),
              ),
            ),
          ),
        ),
      );
      const check = yield* driver
        .preflight(ENTRY, { target: TARGET, profile: Option.none() })
        .pipe(Effect.forkChild);
      yield* Deferred.await(authorizing);
      yield* TestClock.adjust(ConnectionDriver.CONNECTION_ESTABLISHMENT_TIMEOUT);

      expect(check.pollUnsafe()).toBeDefined();
      expect(yield* Fiber.join(check)).toBe(false);
      expect(yield* Ref.get(cancelled)).toBe(true);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
