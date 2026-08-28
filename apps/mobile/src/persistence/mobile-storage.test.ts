import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import type { SavedRemoteConnection } from "../lib/connection";
import { MobileSecureStorage, MobileSecureStorageError } from "./mobile-secure-storage";
import { make } from "./mobile-storage";

function connection(id: string): SavedRemoteConnection {
  return {
    environmentId: EnvironmentId.make(id),
    environmentLabel: id,
    pairingUrl: `https://${id}.example/`,
    displayUrl: `https://${id}.example/`,
    httpBaseUrl: `https://${id}.example/`,
    wsBaseUrl: `wss://${id}.example/`,
    bearerToken: "token",
  };
}

describe("MobileStorage", () => {
  it.effect("serializes and caches concurrent device-id loads", () =>
    Effect.gen(function* () {
      const firstReadStarted = yield* Deferred.make<void>();
      const releaseFirstRead = yield* Deferred.make<void>();
      let readCount = 0;
      let writeCount = 0;
      const secureStorage = MobileSecureStorage.of({
        getItem: () =>
          Effect.gen(function* () {
            readCount += 1;
            if (readCount === 1) {
              yield* Deferred.succeed(firstReadStarted, undefined);
              yield* Deferred.await(releaseFirstRead);
            }
            return "persisted-device-id";
          }),
        setItem: () =>
          Effect.sync(() => {
            writeCount += 1;
          }),
        removeItem: () => Effect.void,
      });
      const storage = yield* make().pipe(Effect.provideService(MobileSecureStorage, secureStorage));
      const loads = yield* Effect.all(
        [storage.loadOrCreateAgentAwarenessDeviceId, storage.loadOrCreateAgentAwarenessDeviceId],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild);

      yield* Deferred.await(firstReadStarted);
      yield* Effect.yieldNow;
      assert.strictEqual(readCount, 1);
      yield* Deferred.succeed(releaseFirstRead, undefined);

      assert.deepStrictEqual(yield* Fiber.join(loads), [
        "persisted-device-id",
        "persisted-device-id",
      ]);
      assert.strictEqual(yield* storage.loadOrCreateAgentAwarenessDeviceId, "persisted-device-id");
      assert.strictEqual(readCount, 1);
      assert.strictEqual(writeCount, 0);
    }),
  );

  it.effect("does not cache a transient device-id read failure", () =>
    Effect.gen(function* () {
      let readCount = 0;
      const secureStorage = MobileSecureStorage.of({
        getItem: (key) => {
          readCount += 1;
          return readCount === 1
            ? Effect.fail(
                new MobileSecureStorageError({
                  operation: "read",
                  key,
                  cause: new Error("temporarily unavailable"),
                }),
              )
            : Effect.succeed("recovered-device-id");
        },
        setItem: () => Effect.void,
        removeItem: () => Effect.void,
      });
      const storage = yield* make().pipe(Effect.provideService(MobileSecureStorage, secureStorage));

      yield* Effect.flip(storage.loadOrCreateAgentAwarenessDeviceId);
      assert.strictEqual(yield* storage.loadOrCreateAgentAwarenessDeviceId, "recovered-device-id");
      assert.strictEqual(yield* storage.loadOrCreateAgentAwarenessDeviceId, "recovered-device-id");
      assert.strictEqual(readCount, 2);
    }),
  );

  it.effect("serializes connection read-modify-write operations", () =>
    Effect.gen(function* () {
      const firstReadStarted = yield* Deferred.make<void>();
      const releaseFirstRead = yield* Deferred.make<void>();
      let raw: string | null = null;
      let readCount = 0;
      const secureStorage = MobileSecureStorage.of({
        getItem: () =>
          Effect.gen(function* () {
            readCount += 1;
            if (readCount === 1) {
              yield* Deferred.succeed(firstReadStarted, undefined);
              yield* Deferred.await(releaseFirstRead);
            }
            return raw;
          }),
        setItem: (_key, value) =>
          Effect.sync(() => {
            raw = value;
          }),
        removeItem: () => Effect.void,
      });
      const storage = yield* make().pipe(Effect.provideService(MobileSecureStorage, secureStorage));
      const saves = yield* Effect.all(
        [
          storage.saveConnection(connection("environment-1")),
          storage.saveConnection(connection("environment-2")),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild);

      yield* Deferred.await(firstReadStarted);
      yield* Effect.yieldNow;
      assert.strictEqual(readCount, 1);
      yield* Deferred.succeed(releaseFirstRead, undefined);
      yield* Fiber.join(saves);

      const parsed = JSON.parse(raw ?? "") as {
        readonly connections: ReadonlyArray<SavedRemoteConnection>;
      };
      assert.deepStrictEqual(
        parsed.connections.map((saved) => saved.environmentId),
        ["environment-1", "environment-2"],
      );
    }),
  );

  it.effect("ignores malformed legacy connection records without failing the load", () =>
    Effect.gen(function* () {
      const secureStorage = MobileSecureStorage.of({
        getItem: () =>
          Effect.succeed(
            JSON.stringify({
              connections: [
                null,
                "invalid",
                { environmentId: "missing-fields" },
                connection("valid"),
              ],
            }),
          ),
        setItem: () => Effect.void,
        removeItem: () => Effect.void,
      });
      const storage = yield* make().pipe(Effect.provideService(MobileSecureStorage, secureStorage));

      assert.deepStrictEqual(yield* storage.loadSavedConnections, [connection("valid")]);
    }),
  );
});
