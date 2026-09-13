import {
  ConnectionTransientError,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { afterEach, vi } from "vite-plus/test";

import {
  makeBrowserGitHubRoutingPermissions,
  makeCatalogBackend,
  makeCatalogStore,
} from "./storage";

const emptyCatalog = {
  schemaVersion: 1,
  targets: [],
  profiles: [],
  credentials: [],
  remoteDpopTokens: [],
  disabledEnvironmentIds: [],
} as const;
const decodeCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument));
const encodeCatalog = Schema.encodeSync(Schema.fromJsonString(ConnectionCatalogDocument));

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

describe("browser GitHub routing permissions", () => {
  it.effect("revokes across runtimes before storage events and resists stale catalog writes", () =>
    Effect.gen(function* () {
      const values = new Map<string, string>();
      const localStorage: Storage = {
        get length() {
          return values.size;
        },
        key: (index) => [...values.keys()][index] ?? null,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
        removeItem: (key) => {
          values.delete(key);
        },
        clear: () => {
          values.clear();
        },
      };
      const firstBrowser = Object.assign(new EventTarget(), { localStorage });
      const secondBrowser = Object.assign(new EventTarget(), { localStorage });
      const first = makeBrowserGitHubRoutingPermissions(firstBrowser);
      const second = makeBrowserGitHubRoutingPermissions(secondBrowser);
      const entry = {
        target: new PrimaryConnectionTarget({
          environmentId: EnvironmentId.make("first"),
          label: "First",
          httpBaseUrl: "http://localhost:3000",
          wsBaseUrl: "ws://localhost:3000",
        }),
        profile: Option.none(),
        enabled: true,
      };
      const other = {
        ...entry,
        target: new PrimaryConnectionTarget({
          ...entry.target,
          environmentId: EnvironmentId.make("second"),
        }),
      };
      expect(yield* first.get(entry)).toBe("off");
      yield* first.set(entry, "read-write");
      expect(yield* second.get(entry)).toBe("read-write");
      const oldPermissions = Option.getOrThrow(yield* Stream.runHead(first.changes));
      const staleCatalog = yield* makeCatalogStore({
        read: Effect.succeed(
          encodeCatalog({ ...emptyCatalog, githubRoutingPermissions: oldPermissions }),
        ),
        write: () => Effect.void,
      });
      yield* staleCatalog.read;
      const listening = yield* Deferred.make<void>();
      const revoked = yield* Deferred.make<void>();
      yield* second.changes.pipe(
        Stream.runForEach((permissions) =>
          Deferred.succeed(permissions.length > 0 ? listening : revoked, undefined),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(listening);

      yield* first.set(entry, "off");
      expect(yield* second.get(entry)).toBe("off");
      secondBrowser.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
      yield* Deferred.await(revoked);
      yield* second.set(other, "read");
      yield* staleCatalog.update((document) => ({ ...document, accountId: "updated" }));
      expect(yield* second.get(entry)).toBe("off");
      expect(yield* first.get(other)).toBe("read");
      expect(yield* makeBrowserGitHubRoutingPermissions(firstBrowser).get(entry)).toBe("off");

      yield* first.set(entry, "read-write");
      yield* second.forget(entry.target.environmentId);
      expect(yield* first.get(entry)).toBe("off");
      expect(yield* first.get(other)).toBe("read");
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
      expect(yield* first.set(entry, "read-write").pipe(Effect.flip)).toBeInstanceOf(
        ConnectionTransientError,
      );
      expect(yield* second.get(entry)).toBe("off");
    }).pipe(Effect.scoped),
  );
});
