import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";

import { makeCatalogBackend, makeCatalogStore } from "./storage";

const emptyCatalog = {
  schemaVersion: 1,
  targets: [],
  profiles: [],
  credentials: [],
  remoteDpopTokens: [],
} as const;
const decodeCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument));

function createFakeDatabase() {
  let requestResult: unknown;
  const request = new EventTarget() as IDBRequest;
  Object.defineProperties(request, {
    error: { get: () => null },
    result: { get: () => requestResult },
  });
  const put = vi.fn();
  const objectStore = {
    get: vi.fn(() => request),
    put,
  } as unknown as IDBObjectStore;
  const transaction = new EventTarget() as IDBTransaction;
  const abort = vi.fn();
  Object.defineProperties(transaction, {
    abort: { value: abort },
    error: { get: () => null },
    objectStore: { value: () => objectStore },
  });
  const database = {
    transaction: vi.fn(() => transaction),
  } as unknown as IDBDatabase;
  return {
    abort,
    database,
    put,
    request,
    setRequestResult: (value: unknown) => {
      requestResult = value;
    },
    transaction,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("makeCatalogStore", () => {
  it.effect("quarantines malformed catalogs and starts from an empty document", () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const quarantined: string[] = [];
      const store = yield* makeCatalogStore({
        read: Effect.succeed("{not-json"),
        write: (raw) => Effect.sync(() => writes.push(raw)),
        quarantine: (raw) => Effect.sync(() => quarantined.push(raw)),
      });

      expect(yield* store.read).toEqual(emptyCatalog);
      expect(quarantined).toEqual(["{not-json"]);
      expect(writes).toHaveLength(1);
      expect(decodeCatalog(writes[0]!)).toEqual(emptyCatalog);
    }),
  );

  it.effect("does not hide catalog read failures", () =>
    Effect.gen(function* () {
      const failure = new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "permission denied",
      });
      const store = yield* makeCatalogStore({
        read: Effect.fail(failure),
        write: () => Effect.void,
      });

      expect(yield* Effect.flip(store.read)).toBe(failure);
    }),
  );
});

describe("makeCatalogBackend", () => {
  it.effect("fails writes when desktop secure storage declines the catalog", () =>
    Effect.gen(function* () {
      const setConnectionCatalog = vi.fn().mockResolvedValue(false);
      vi.stubGlobal("window", {
        desktopBridge: {
          getConnectionCatalog: vi.fn().mockResolvedValue(null),
          setConnectionCatalog,
        },
      });
      const backend = makeCatalogBackend({} as IDBDatabase);

      const error = yield* backend.write("{}").pipe(Effect.flip);

      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error.message).toContain("Desktop secure storage is unavailable");
      expect(setConnectionCatalog).toHaveBeenCalledWith("{}");
    }),
  );

  it.effect("waits for the read transaction to commit before returning its value", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", { desktopBridge: undefined });
      const fake = createFakeDatabase();
      const backend = makeCatalogBackend(fake.database);
      const result = yield* backend.read.pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      fake.setRequestResult("catalog");
      fake.request.dispatchEvent(new Event("success"));
      yield* Effect.yieldNow;
      expect(result.pollUnsafe()).toBeUndefined();

      fake.transaction.dispatchEvent(new Event("complete"));
      expect(yield* Fiber.join(result)).toBe("catalog");
    }),
  );

  it.effect("fails an aborted write instead of leaving it pending", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", { desktopBridge: undefined });
      const fake = createFakeDatabase();
      const backend = makeCatalogBackend(fake.database);
      const result = yield* backend.write("{}").pipe(Effect.flip, Effect.forkChild);
      yield* Effect.yieldNow;

      fake.transaction.dispatchEvent(new Event("abort"));

      expect(yield* Fiber.join(result)).toEqual(
        expect.objectContaining({
          _tag: "ConnectionTransientError",
          detail: expect.stringContaining("transaction aborted"),
        }),
      );
    }),
  );

  it.effect("aborts an unfinished transaction when its caller is interrupted", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", { desktopBridge: undefined });
      const fake = createFakeDatabase();
      const backend = makeCatalogBackend(fake.database);
      const result = yield* backend.read.pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      yield* Fiber.interrupt(result);

      expect(fake.abort).toHaveBeenCalledOnce();
    }),
  );

  it.effect("reuses one bounded quarantine key", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", { desktopBridge: undefined });
      const fake = createFakeDatabase();
      const backend = makeCatalogBackend(fake.database);
      const result = yield* backend.quarantine!("corrupt catalog").pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      expect(fake.put).toHaveBeenCalledWith("corrupt catalog", "document:corrupt");
      fake.transaction.dispatchEvent(new Event("complete"));
      yield* Fiber.join(result);
    }),
  );
});
