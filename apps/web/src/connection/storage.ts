import {
  ConnectionCatalogDocument,
  type ConnectionCatalogDocument as ConnectionCatalogDocumentType,
  ConnectionPersistenceError,
  ConnectionRegistrationStore,
  ConnectionTargetStore,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  EnvironmentCacheStore,
  registerConnectionInCatalog,
  removeCatalogValue,
  removeConnectionFromCatalog,
  replaceCatalogValue,
} from "@t3tools/client-runtime/platform";
import { TokenStore } from "@t3tools/client-runtime/authorization";
import {
  ConnectionTransientError,
  CredentialStore,
  ProfileStore,
} from "@t3tools/client-runtime/connection";
import {
  decodeStoredPendingEntries,
  encodePendingEntries,
  ThreadLifecycleOutboxPersistenceError,
  ThreadLifecycleOutboxStore,
} from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  OrchestrationShellSnapshot,
  OrchestrationThreadDetailSnapshot,
  ServerConfig,
  ThreadId,
  VcsListRefsResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

const DATABASE_NAME = "t3code:connection-runtime";
const DATABASE_VERSION = 5;
const CATALOG_STORE_NAME = "catalog";
const SHELL_STORE_NAME = "shell";
const THREAD_STORE_NAME = "thread";
const SERVER_CONFIG_STORE_NAME = "server-config";
const VCS_REFS_STORE_NAME = "vcs-refs";
const THREAD_LIFECYCLE_OUTBOX_STORE_NAME = "thread-lifecycle-outbox";
const CATALOG_KEY = "document";
const CORRUPT_CATALOG_KEY = `${CATALOG_KEY}:corrupt`;
const SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION = 1;
const BLOCKED_DATABASE_OPEN_TIMEOUT_MS = 10_000;

const StoredShellSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION),
  environmentId: EnvironmentId,
  snapshot: OrchestrationShellSnapshot,
});
const StoredShellSnapshotJson = Schema.fromJsonString(StoredShellSnapshot);
// v2 stores the snapshot sequence alongside the thread so a warm cache can
// resume via `afterSequence` instead of re-downloading the full thread body.
// v3 adds windowed (paginated) snapshots carrying `page` metadata. The bump
// exists for rollback safety: a pre-pagination client would decode a windowed
// v2 record, silently drop the unknown `page` field, and treat the partial
// thread as complete forever. Older entries fail to decode → cold cache.
const StoredThreadSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  snapshot: OrchestrationThreadDetailSnapshot,
});
const StoredThreadSnapshotJson = Schema.fromJsonString(StoredThreadSnapshot);
const StoredServerConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: EnvironmentId,
  config: ServerConfig,
});
const StoredServerConfigJson = Schema.fromJsonString(StoredServerConfig);
const StoredVcsRefs = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: EnvironmentId,
  cwd: Schema.String,
  refs: VcsListRefsResult,
});
const StoredVcsRefsJson = Schema.fromJsonString(StoredVcsRefs);
const ConnectionCatalogDocumentJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeConnectionCatalogDocument = Schema.decodeUnknownEffect(ConnectionCatalogDocumentJson);
const encodeConnectionCatalogDocument = Schema.encodeEffect(ConnectionCatalogDocumentJson);
const decodeStoredShellSnapshot = Schema.decodeUnknownEffect(StoredShellSnapshotJson);
const encodeStoredShellSnapshot = Schema.encodeEffect(StoredShellSnapshotJson);
const decodeStoredThreadSnapshot = Schema.decodeUnknownEffect(StoredThreadSnapshotJson);
const encodeStoredThreadSnapshot = Schema.encodeEffect(StoredThreadSnapshotJson);
const decodeStoredServerConfig = Schema.decodeUnknownEffect(StoredServerConfigJson);
const encodeStoredServerConfig = Schema.encodeEffect(StoredServerConfigJson);
const decodeStoredVcsRefs = Schema.decodeUnknownEffect(StoredVcsRefsJson);
const encodeStoredVcsRefs = Schema.encodeEffect(StoredVcsRefsJson);

function catalogError(operation: string, cause: unknown) {
  return new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: `Could not ${operation} the local connection catalog: ${String(cause)}`,
  });
}

function persistenceError(
  operation:
    | "list-targets"
    | "register-connection"
    | "remove-connection"
    | "load-shell"
    | "save-shell"
    | "load-thread"
    | "save-thread"
    | "remove-thread"
    | "load-server-config"
    | "save-server-config"
    | "load-vcs-refs"
    | "save-vcs-refs"
    | "remove-vcs-refs"
    | "clear-vcs-refs"
    | "clear-environment",
  cause: unknown,
) {
  return new ConnectionPersistenceError({
    operation,
    message: `Could not ${operation.replaceAll("-", " ")}: ${String(cause)}`,
  });
}

const openDatabase = Effect.fn("web.connectionStorage.openDatabase")(function* () {
  return yield* Effect.callback<IDBDatabase, ConnectionTransientError>((resume) => {
    if (typeof indexedDB === "undefined") {
      resume(
        Effect.fail(catalogError("open", "IndexedDB is unavailable in this browser context.")),
      );
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (cause) {
      resume(Effect.fail(catalogError("open", cause)));
      return;
    }
    let settled = false;
    let blockedTimeout: ReturnType<typeof setTimeout> | null = null;
    const settle = (effect: Effect.Effect<IDBDatabase, ConnectionTransientError>) => {
      if (settled) return false;
      settled = true;
      if (blockedTimeout !== null) {
        clearTimeout(blockedTimeout);
        blockedTimeout = null;
      }
      resume(effect);
      return true;
    };
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(CATALOG_STORE_NAME)) {
        request.result.createObjectStore(CATALOG_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(SHELL_STORE_NAME)) {
        request.result.createObjectStore(SHELL_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(THREAD_STORE_NAME)) {
        request.result.createObjectStore(THREAD_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(SERVER_CONFIG_STORE_NAME)) {
        request.result.createObjectStore(SERVER_CONFIG_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(VCS_REFS_STORE_NAME)) {
        request.result.createObjectStore(VCS_REFS_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(THREAD_LIFECYCLE_OUTBOX_STORE_NAME)) {
        request.result.createObjectStore(THREAD_LIFECYCLE_OUTBOX_STORE_NAME);
      }
    });
    request.addEventListener("error", () => {
      settle(Effect.fail(catalogError("open", request.error ?? "Unknown IndexedDB error")));
    });
    request.addEventListener("blocked", () => {
      if (blockedTimeout !== null) return;
      blockedTimeout = setTimeout(() => {
        settle(
          Effect.fail(
            catalogError(
              "open",
              "IndexedDB upgrade is blocked by another open T3 Code tab. Close or reload the older tab and retry.",
            ),
          ),
        );
      }, BLOCKED_DATABASE_OPEN_TIMEOUT_MS);
    });
    request.addEventListener("success", () => {
      const database = request.result;
      if (!settle(Effect.succeed(database))) {
        // A blocked request can still succeed after its caller has already
        // failed. Do not leave that late database handle open indefinitely.
        database.close();
        return;
      }
      // Cooperate with a future schema upgrade in another tab instead of
      // holding it blocked for the lifetime of this page.
      database.addEventListener("versionchange", () => database.close(), { once: true });
    });

    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      if (blockedTimeout !== null) {
        clearTimeout(blockedTimeout);
        blockedTimeout = null;
      }
      // IDBOpenDBRequest cannot be aborted. Marking the callback settled makes
      // its eventual success handler close the late database handle instead.
    });
  });
});

function readDatabaseValue(database: IDBDatabase, storeName: string, key: IDBValidKey) {
  return Effect.callback<unknown, ConnectionTransientError>((resume) => {
    let settled = false;
    let transaction: IDBTransaction | null = null;
    const settle = (effect: Effect.Effect<unknown, ConnectionTransientError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    try {
      const activeTransaction = database.transaction(storeName, "readonly");
      transaction = activeTransaction;
      const request = activeTransaction.objectStore(storeName).get(key);
      let result: unknown;
      let requestSucceeded = false;
      request.addEventListener("success", () => {
        result = request.result;
        requestSucceeded = true;
      });
      request.addEventListener("error", () => {
        settle(Effect.fail(catalogError("read", request.error ?? "Unknown IndexedDB read error")));
      });
      activeTransaction.addEventListener("error", () => {
        settle(
          Effect.fail(
            catalogError("read", activeTransaction.error ?? "Unknown IndexedDB transaction error"),
          ),
        );
      });
      activeTransaction.addEventListener("abort", () => {
        settle(
          Effect.fail(
            catalogError("read", activeTransaction.error ?? "IndexedDB read transaction aborted"),
          ),
        );
      });
      activeTransaction.addEventListener("complete", () => {
        settle(
          requestSucceeded
            ? Effect.succeed(result)
            : Effect.fail(catalogError("read", "IndexedDB read completed without a result")),
        );
      });
    } catch (cause) {
      settle(Effect.fail(catalogError("read", cause)));
    }
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      try {
        transaction?.abort();
      } catch {
        // A transaction can finish between interruption and cleanup.
      }
    });
  }).pipe(Effect.withSpan("web.connectionStorage.readDatabaseValue"));
}

function writeDatabaseValue(
  database: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
  value: unknown,
) {
  return Effect.callback<void, ConnectionTransientError>((resume) => {
    let settled = false;
    let transaction: IDBTransaction | null = null;
    const settle = (effect: Effect.Effect<void, ConnectionTransientError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    try {
      const activeTransaction = database.transaction(storeName, "readwrite");
      transaction = activeTransaction;
      activeTransaction.addEventListener("error", () => {
        settle(
          Effect.fail(
            catalogError("write", activeTransaction.error ?? "Unknown IndexedDB write error"),
          ),
        );
      });
      activeTransaction.addEventListener("abort", () => {
        settle(
          Effect.fail(
            catalogError("write", activeTransaction.error ?? "IndexedDB write transaction aborted"),
          ),
        );
      });
      activeTransaction.addEventListener("complete", () => {
        settle(Effect.void);
      });
      activeTransaction.objectStore(storeName).put(value, key);
    } catch (cause) {
      settle(Effect.fail(catalogError("write", cause)));
    }
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      try {
        transaction?.abort();
      } catch {
        // A transaction can finish between interruption and cleanup.
      }
    });
  }).pipe(Effect.withSpan("web.connectionStorage.writeDatabaseValue"));
}

function removeDatabaseValue(database: IDBDatabase, storeName: string, key: IDBValidKey) {
  return Effect.callback<void, ConnectionTransientError>((resume) => {
    let settled = false;
    let transaction: IDBTransaction | null = null;
    const settle = (effect: Effect.Effect<void, ConnectionTransientError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    try {
      const activeTransaction = database.transaction(storeName, "readwrite");
      transaction = activeTransaction;
      activeTransaction.addEventListener("error", () => {
        settle(
          Effect.fail(
            catalogError("remove", activeTransaction.error ?? "Unknown IndexedDB remove error"),
          ),
        );
      });
      activeTransaction.addEventListener("abort", () => {
        settle(
          Effect.fail(
            catalogError(
              "remove",
              activeTransaction.error ?? "IndexedDB remove transaction aborted",
            ),
          ),
        );
      });
      activeTransaction.addEventListener("complete", () => {
        settle(Effect.void);
      });
      activeTransaction.objectStore(storeName).delete(key);
    } catch (cause) {
      settle(Effect.fail(catalogError("remove", cause)));
    }
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      try {
        transaction?.abort();
      } catch {
        // A transaction can finish between interruption and cleanup.
      }
    });
  }).pipe(Effect.withSpan("web.connectionStorage.removeDatabaseValue"));
}

function removeDatabaseValuesInRange(database: IDBDatabase, storeName: string, range: IDBKeyRange) {
  return Effect.callback<void, ConnectionTransientError>((resume) => {
    let settled = false;
    let transaction: IDBTransaction | null = null;
    const settle = (effect: Effect.Effect<void, ConnectionTransientError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    try {
      const activeTransaction = database.transaction(storeName, "readwrite");
      transaction = activeTransaction;
      activeTransaction.addEventListener("error", () => {
        settle(
          Effect.fail(
            catalogError("remove", activeTransaction.error ?? "Unknown IndexedDB cursor error"),
          ),
        );
      });
      activeTransaction.addEventListener("abort", () => {
        settle(
          Effect.fail(
            catalogError(
              "remove",
              activeTransaction.error ?? "IndexedDB cursor transaction aborted",
            ),
          ),
        );
      });
      activeTransaction.addEventListener("complete", () => {
        settle(Effect.void);
      });
      const request = activeTransaction.objectStore(storeName).openCursor(range);
      request.addEventListener("error", () => {
        settle(
          Effect.fail(catalogError("remove", request.error ?? "Unknown IndexedDB cursor error")),
        );
      });
      request.addEventListener("success", () => {
        const cursor = request.result;
        if (cursor === null) {
          return;
        }
        cursor.delete();
        cursor.continue();
      });
    } catch (cause) {
      settle(Effect.fail(catalogError("remove", cause)));
    }
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      try {
        transaction?.abort();
      } catch {
        // A transaction can finish between interruption and cleanup.
      }
    });
  }).pipe(Effect.withSpan("web.connectionStorage.removeDatabaseValuesInRange"));
}

const discardCorruptCacheValue = Effect.fn("web.connectionStorage.discardCorruptCacheValue")(
  function* (
    database: IDBDatabase,
    storeName: string,
    key: IDBValidKey,
    cacheName: string,
    cause: unknown,
  ) {
    yield* Effect.logWarning(`Discarding a corrupt ${cacheName} cache entry.`, {
      error: String(cause),
    });
    yield* Effect.ignore(
      removeDatabaseValue(database, storeName, key).pipe(
        Effect.tapError((cleanupCause) =>
          Effect.logWarning(`Could not remove the corrupt ${cacheName} cache entry.`, {
            error: cleanupCause.message,
          }),
        ),
      ),
    );
    return Option.none();
  },
);

function threadCacheKey(environmentId: EnvironmentId, threadId: ThreadId) {
  return `${environmentId}:${threadId}`;
}

function vcsRefsCacheKey(environmentId: EnvironmentId, cwd: string) {
  return `${environmentId}:${cwd}`;
}

const decodeCatalog = Effect.fn("web.connectionStorage.decodeCatalog")(function* (raw: string) {
  return yield* decodeConnectionCatalogDocument(raw).pipe(
    Effect.mapError((cause) => catalogError("decode", cause)),
  );
});

const encodeCatalog = Effect.fn("web.connectionStorage.encodeCatalog")(function* (
  catalog: ConnectionCatalogDocumentType,
) {
  return yield* encodeConnectionCatalogDocument(catalog).pipe(
    Effect.mapError((cause) => catalogError("encode", cause)),
  );
});

export interface CatalogBackend {
  readonly read: Effect.Effect<string | null, ConnectionTransientError>;
  readonly write: (raw: string) => Effect.Effect<void, ConnectionTransientError>;
  readonly quarantine?: (raw: string) => Effect.Effect<void, ConnectionTransientError>;
}

export function makeCatalogBackend(database: IDBDatabase): CatalogBackend {
  const bridge = window.desktopBridge;
  if (bridge?.getConnectionCatalog !== undefined && bridge.setConnectionCatalog !== undefined) {
    return {
      read: Effect.tryPromise({
        try: () => bridge.getConnectionCatalog!(),
        catch: (cause) => catalogError("load", cause),
      }),
      write: (raw) =>
        Effect.tryPromise({
          try: () => bridge.setConnectionCatalog!(raw),
          catch: (cause) => catalogError("save", cause),
        }).pipe(
          Effect.flatMap((stored) =>
            stored
              ? Effect.void
              : Effect.fail(
                  catalogError(
                    "save",
                    "Desktop secure storage is unavailable in this system context.",
                  ),
                ),
          ),
        ),
    };
  }

  return {
    read: readDatabaseValue(database, CATALOG_STORE_NAME, CATALOG_KEY).pipe(
      Effect.map((value) => (typeof value === "string" ? value : null)),
    ),
    write: (raw) => writeDatabaseValue(database, CATALOG_STORE_NAME, CATALOG_KEY, raw),
    quarantine: (raw) => writeDatabaseValue(database, CATALOG_STORE_NAME, CORRUPT_CATALOG_KEY, raw),
  };
}

interface CatalogStore {
  readonly read: Effect.Effect<ConnectionCatalogDocumentType, ConnectionTransientError>;
  readonly update: (
    transform: (catalog: ConnectionCatalogDocumentType) => ConnectionCatalogDocumentType,
  ) => Effect.Effect<void, ConnectionTransientError>;
}

export const makeCatalogStore = Effect.fn("web.connectionStorage.makeCatalogStore")(function* (
  backend: CatalogBackend,
) {
  const state = yield* Ref.make<Option.Option<ConnectionCatalogDocumentType>>(Option.none());
  const lock = yield* Semaphore.make(1);

  const loadUnlocked = Effect.fn("web.connectionStorage.loadCatalog")(function* () {
    const cached = yield* Ref.get(state);
    if (Option.isSome(cached)) {
      return cached.value;
    }
    const raw = yield* backend.read;
    let catalog = EMPTY_CONNECTION_CATALOG_DOCUMENT;
    if (raw !== null && raw.trim() !== "") {
      catalog = yield* decodeCatalog(raw).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("Discarding a corrupt web connection catalog.", {
              error: error.message,
            });
            if (backend.quarantine !== undefined) {
              yield* backend.quarantine(raw).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Could not quarantine the corrupt web connection catalog.", {
                    error: cause.message,
                  }),
                ),
              );
            }
            const encoded = yield* encodeCatalog(EMPTY_CONNECTION_CATALOG_DOCUMENT);
            yield* backend.write(encoded).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("Could not persist the recovered web connection catalog.", {
                  error: cause.message,
                }),
              ),
            );
            return EMPTY_CONNECTION_CATALOG_DOCUMENT;
          }),
        ),
      );
    }
    yield* Ref.set(state, Option.some(catalog));
    return catalog;
  });

  const read = lock.withPermits(1)(loadUnlocked());
  const update: CatalogStore["update"] = Effect.fn("web.connectionStorage.updateCatalog")(
    function* (transform) {
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const next = transform(yield* loadUnlocked());
          yield* backend.write(yield* encodeCatalog(next));
          yield* Ref.set(state, Option.some(next));
        }),
      );
    },
  );

  return { read, update } satisfies CatalogStore;
});

export const connectionStorageLayer = Layer.effectContext(
  Effect.gen(function* () {
    const database = yield* Effect.acquireRelease(openDatabase(), (database) =>
      Effect.sync(() => database.close()),
    );
    const catalog = yield* makeCatalogStore(makeCatalogBackend(database));

    const targetStore = ConnectionTargetStore.of({
      list: catalog.read.pipe(
        Effect.map((document) => document.targets),
        Effect.mapError((cause) => persistenceError("list-targets", cause)),
      ),
    });
    const registrationStore = ConnectionRegistrationStore.of({
      register: (registration) =>
        catalog
          .update((document) => registerConnectionInCatalog(document, registration))
          .pipe(Effect.mapError((cause) => persistenceError("register-connection", cause))),
      remove: (target) =>
        catalog
          .update((document) => removeConnectionFromCatalog(document, target))
          .pipe(Effect.mapError((cause) => persistenceError("remove-connection", cause))),
    });
    const profileStore = ProfileStore.make({
      get: (connectionId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.profiles.find((profile) => profile.connectionId === connectionId),
            ),
          ),
        ),
      put: (profile) =>
        catalog.update((document) => ({
          ...document,
          profiles: replaceCatalogValue(document.profiles, (value) => value.connectionId, profile),
        })),
      remove: (connectionId) =>
        catalog.update((document) => ({
          ...document,
          profiles: removeCatalogValue(
            document.profiles,
            (value) => value.connectionId,
            connectionId,
          ),
        })),
    });
    const credentialStore = CredentialStore.make({
      get: (connectionId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.credentials.find((entry) => entry.connectionId === connectionId)?.credential,
            ),
          ),
        ),
      put: (connectionId, credential) =>
        catalog.update((document) => ({
          ...document,
          credentials: replaceCatalogValue(document.credentials, (value) => value.connectionId, {
            connectionId,
            credential,
          }),
        })),
      remove: (connectionId) =>
        catalog.update((document) => ({
          ...document,
          credentials: removeCatalogValue(
            document.credentials,
            (value) => value.connectionId,
            connectionId,
          ),
        })),
    });
    const remoteTokenStore = TokenStore.make({
      get: (environmentId) =>
        catalog.read.pipe(
          Effect.map((document) =>
            Option.fromUndefinedOr(
              document.remoteDpopTokens.find((token) => token.environmentId === environmentId),
            ),
          ),
        ),
      put: (token) =>
        catalog.update((document) => ({
          ...document,
          remoteDpopTokens: replaceCatalogValue(
            document.remoteDpopTokens,
            (value) => value.environmentId,
            token,
          ),
        })),
      remove: (environmentId) =>
        catalog.update((document) => ({
          ...document,
          remoteDpopTokens: removeCatalogValue(
            document.remoteDpopTokens,
            (value) => value.environmentId,
            environmentId,
          ),
        })),
    });
    const lifecycleOutboxStore = ThreadLifecycleOutboxStore.of({
      load: (environmentId) =>
        readDatabaseValue(database, THREAD_LIFECYCLE_OUTBOX_STORE_NAME, environmentId).pipe(
          Effect.flatMap((raw) => {
            if (typeof raw !== "string") {
              return Effect.succeed([]);
            }
            return decodeStoredPendingEntries(raw).pipe(
              Effect.mapError(
                (cause) =>
                  new ThreadLifecycleOutboxPersistenceError({
                    operation: "load",
                    message: `Could not load queued thread lifecycle commands: ${String(cause)}`,
                  }),
              ),
              Effect.map((entries) =>
                entries.filter((entry) => entry.environmentId === environmentId),
              ),
            );
          }),
          Effect.mapError((cause) =>
            cause._tag === "ThreadLifecycleOutboxPersistenceError"
              ? cause
              : new ThreadLifecycleOutboxPersistenceError({
                  operation: "load",
                  message: `Could not load queued thread lifecycle commands: ${String(cause)}`,
                }),
          ),
        ),
      save: (environmentId, entries) =>
        Effect.gen(function* () {
          if (entries.length === 0) {
            yield* removeDatabaseValue(database, THREAD_LIFECYCLE_OUTBOX_STORE_NAME, environmentId);
            return;
          }
          const encoded = yield* encodePendingEntries(entries).pipe(
            Effect.mapError(
              (cause) =>
                new ThreadLifecycleOutboxPersistenceError({
                  operation: "save",
                  message: `Could not save queued thread lifecycle commands: ${String(cause)}`,
                }),
            ),
          );
          yield* writeDatabaseValue(
            database,
            THREAD_LIFECYCLE_OUTBOX_STORE_NAME,
            environmentId,
            encoded,
          );
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === "ThreadLifecycleOutboxPersistenceError"
              ? cause
              : new ThreadLifecycleOutboxPersistenceError({
                  operation: "save",
                  message: `Could not save queued thread lifecycle commands: ${String(cause)}`,
                }),
          ),
        ),
    });
    const cacheStore = EnvironmentCacheStore.of({
      loadShell: (environmentId) =>
        readDatabaseValue(database, SHELL_STORE_NAME, environmentId).pipe(
          Effect.flatMap((raw) => {
            if (typeof raw !== "string") {
              return Effect.succeed(Option.none());
            }
            return decodeStoredShellSnapshot(raw).pipe(
              Effect.flatMap((stored) =>
                stored.environmentId === environmentId
                  ? Effect.succeed(Option.some(stored.snapshot))
                  : discardCorruptCacheValue(
                      database,
                      SHELL_STORE_NAME,
                      environmentId,
                      "shell snapshot",
                      "stored environment does not match its key",
                    ),
              ),
              Effect.catch((cause) =>
                discardCorruptCacheValue(
                  database,
                  SHELL_STORE_NAME,
                  environmentId,
                  "shell snapshot",
                  cause,
                ),
              ),
            );
          }),
          Effect.mapError((cause) => persistenceError("load-shell", cause)),
        ),
      saveShell: (environmentId, snapshot) =>
        Effect.gen(function* () {
          const encoded = yield* encodeStoredShellSnapshot({
            schemaVersion: SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION,
            environmentId,
            snapshot,
          }).pipe(Effect.mapError((cause) => persistenceError("save-shell", cause)));
          yield* writeDatabaseValue(database, SHELL_STORE_NAME, environmentId, encoded);
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("save-shell", cause),
          ),
        ),
      loadServerConfig: (environmentId) =>
        readDatabaseValue(database, SERVER_CONFIG_STORE_NAME, environmentId).pipe(
          Effect.flatMap((raw) => {
            if (typeof raw !== "string") {
              return Effect.succeed(Option.none());
            }
            return decodeStoredServerConfig(raw).pipe(
              Effect.flatMap((stored) =>
                stored.environmentId === environmentId
                  ? Effect.succeed(Option.some(stored.config))
                  : discardCorruptCacheValue(
                      database,
                      SERVER_CONFIG_STORE_NAME,
                      environmentId,
                      "server config",
                      "stored environment does not match its key",
                    ),
              ),
              Effect.catch((cause) =>
                discardCorruptCacheValue(
                  database,
                  SERVER_CONFIG_STORE_NAME,
                  environmentId,
                  "server config",
                  cause,
                ),
              ),
            );
          }),
          Effect.mapError((cause) => persistenceError("load-server-config", cause)),
        ),
      saveServerConfig: (environmentId, config) =>
        Effect.gen(function* () {
          const encoded = yield* encodeStoredServerConfig({
            schemaVersion: 1,
            environmentId,
            config,
          }).pipe(Effect.mapError((cause) => persistenceError("save-server-config", cause)));
          yield* writeDatabaseValue(database, SERVER_CONFIG_STORE_NAME, environmentId, encoded);
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("save-server-config", cause),
          ),
        ),
      loadThread: (environmentId, threadId) =>
        readDatabaseValue(
          database,
          THREAD_STORE_NAME,
          threadCacheKey(environmentId, threadId),
        ).pipe(
          Effect.flatMap((raw) => {
            if (typeof raw !== "string") {
              return Effect.succeed(Option.none());
            }
            return decodeStoredThreadSnapshot(raw).pipe(
              Effect.flatMap((stored) =>
                stored.environmentId === environmentId && stored.threadId === threadId
                  ? Effect.succeed(Option.some(stored.snapshot))
                  : discardCorruptCacheValue(
                      database,
                      THREAD_STORE_NAME,
                      threadCacheKey(environmentId, threadId),
                      "thread snapshot",
                      "stored thread identity does not match its key",
                    ),
              ),
              Effect.catch((cause) =>
                discardCorruptCacheValue(
                  database,
                  THREAD_STORE_NAME,
                  threadCacheKey(environmentId, threadId),
                  "thread snapshot",
                  cause,
                ),
              ),
            );
          }),
          Effect.mapError((cause) => persistenceError("load-thread", cause)),
        ),
      saveThread: (environmentId, snapshot) =>
        Effect.gen(function* () {
          const encoded = yield* encodeStoredThreadSnapshot({
            schemaVersion: 3,
            environmentId,
            threadId: snapshot.thread.id,
            snapshot,
          }).pipe(Effect.mapError((cause) => persistenceError("save-thread", cause)));
          yield* writeDatabaseValue(
            database,
            THREAD_STORE_NAME,
            threadCacheKey(environmentId, snapshot.thread.id),
            encoded,
          );
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("save-thread", cause),
          ),
        ),
      loadVcsRefs: (environmentId, cwd) =>
        readDatabaseValue(database, VCS_REFS_STORE_NAME, vcsRefsCacheKey(environmentId, cwd)).pipe(
          Effect.flatMap((raw) => {
            if (typeof raw !== "string") {
              return Effect.succeed(Option.none());
            }
            return decodeStoredVcsRefs(raw).pipe(
              Effect.flatMap((stored) =>
                stored.environmentId === environmentId && stored.cwd === cwd
                  ? Effect.succeed(Option.some(stored.refs))
                  : discardCorruptCacheValue(
                      database,
                      VCS_REFS_STORE_NAME,
                      vcsRefsCacheKey(environmentId, cwd),
                      "VCS refs",
                      "stored environment or cwd does not match its key",
                    ),
              ),
              Effect.catch((cause) =>
                discardCorruptCacheValue(
                  database,
                  VCS_REFS_STORE_NAME,
                  vcsRefsCacheKey(environmentId, cwd),
                  "VCS refs",
                  cause,
                ),
              ),
            );
          }),
          Effect.mapError((cause) => persistenceError("load-vcs-refs", cause)),
        ),
      saveVcsRefs: (environmentId, cwd, refs) =>
        Effect.gen(function* () {
          const encoded = yield* encodeStoredVcsRefs({
            schemaVersion: 1,
            environmentId,
            cwd,
            refs,
          }).pipe(Effect.mapError((cause) => persistenceError("save-vcs-refs", cause)));
          yield* writeDatabaseValue(
            database,
            VCS_REFS_STORE_NAME,
            vcsRefsCacheKey(environmentId, cwd),
            encoded,
          );
        }).pipe(
          Effect.mapError((cause) =>
            cause._tag === "ConnectionPersistenceError"
              ? cause
              : persistenceError("save-vcs-refs", cause),
          ),
        ),
      removeVcsRefs: (environmentId, cwd) =>
        removeDatabaseValue(
          database,
          VCS_REFS_STORE_NAME,
          vcsRefsCacheKey(environmentId, cwd),
        ).pipe(Effect.mapError((cause) => persistenceError("remove-vcs-refs", cause))),
      clearVcsRefs: (environmentId) =>
        removeDatabaseValuesInRange(
          database,
          VCS_REFS_STORE_NAME,
          IDBKeyRange.bound(`${environmentId}:`, `${environmentId}:\uffff`),
        ).pipe(Effect.mapError((cause) => persistenceError("clear-vcs-refs", cause))),
      removeThread: (environmentId, threadId) =>
        removeDatabaseValue(
          database,
          THREAD_STORE_NAME,
          threadCacheKey(environmentId, threadId),
        ).pipe(Effect.mapError((cause) => persistenceError("remove-thread", cause))),
      clear: (environmentId) =>
        Effect.all(
          [
            removeDatabaseValue(database, SHELL_STORE_NAME, environmentId),
            removeDatabaseValuesInRange(
              database,
              THREAD_STORE_NAME,
              IDBKeyRange.bound(`${environmentId}:`, `${environmentId}:\uffff`),
            ),
            removeDatabaseValue(database, SERVER_CONFIG_STORE_NAME, environmentId),
            removeDatabaseValuesInRange(
              database,
              VCS_REFS_STORE_NAME,
              IDBKeyRange.bound(`${environmentId}:`, `${environmentId}:\uffff`),
            ),
            removeDatabaseValue(database, THREAD_LIFECYCLE_OUTBOX_STORE_NAME, environmentId),
          ],
          { concurrency: "unbounded", discard: true },
        ).pipe(Effect.mapError((cause) => persistenceError("clear-environment", cause))),
    });

    return Context.make(ConnectionTargetStore, targetStore).pipe(
      Context.add(ConnectionRegistrationStore, registrationStore),
      Context.add(ProfileStore.ConnectionProfileStore, profileStore),
      Context.add(CredentialStore.ConnectionCredentialStore, credentialStore),
      Context.add(TokenStore.RemoteDpopAccessTokenStore, remoteTokenStore),
      Context.add(EnvironmentCacheStore, cacheStore),
      Context.add(ThreadLifecycleOutboxStore, lifecycleOutboxStore),
    );
  }),
);
