import {
  decodeStoredPendingEntries,
  encodePendingEntries,
  ThreadLifecycleOutboxPersistenceError,
  ThreadLifecycleOutboxStore,
} from "@t3tools/client-runtime/state/shell";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as MobileDatabase from "../persistence/mobile-database";

const THREAD_LIFECYCLE_OUTBOX_SCHEMA_VERSION = 1;
const CACHE_KEY = "pending";

export const make = Effect.fn("MobileThreadLifecycleOutboxStore.make")(function* () {
  const database = yield* MobileDatabase.MobileDatabase;
  return ThreadLifecycleOutboxStore.of({
    load: Effect.fn("MobileThreadLifecycleOutboxStore.load")(function* (environmentId) {
      const raw = yield* database
        .loadCache(environmentId, "thread-lifecycle-outbox", CACHE_KEY)
        .pipe(
          Effect.mapError(
            (cause) =>
              new ThreadLifecycleOutboxPersistenceError({
                operation: "load",
                message: `Could not load queued thread lifecycle commands: ${String(cause)}`,
              }),
          ),
        );
      if (Option.isNone(raw)) {
        return [];
      }
      return yield* decodeStoredPendingEntries(raw.value).pipe(
        Effect.map((entries) => entries.filter((entry) => entry.environmentId === environmentId)),
        Effect.mapError(
          (cause) =>
            new ThreadLifecycleOutboxPersistenceError({
              operation: "load",
              message: `Could not load queued thread lifecycle commands: ${String(cause)}`,
            }),
        ),
      );
    }),
    save: Effect.fn("MobileThreadLifecycleOutboxStore.save")(function* (environmentId, entries) {
      if (entries.length === 0) {
        yield* database.removeCache(environmentId, "thread-lifecycle-outbox", CACHE_KEY).pipe(
          Effect.mapError(
            (cause) =>
              new ThreadLifecycleOutboxPersistenceError({
                operation: "save",
                message: `Could not save queued thread lifecycle commands: ${String(cause)}`,
              }),
          ),
        );
        return;
      }
      const payload = yield* encodePendingEntries(entries).pipe(
        Effect.mapError(
          (cause) =>
            new ThreadLifecycleOutboxPersistenceError({
              operation: "save",
              message: `Could not save queued thread lifecycle commands: ${String(cause)}`,
            }),
        ),
      );
      yield* database
        .saveCache(
          environmentId,
          "thread-lifecycle-outbox",
          CACHE_KEY,
          THREAD_LIFECYCLE_OUTBOX_SCHEMA_VERSION,
          payload,
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new ThreadLifecycleOutboxPersistenceError({
                operation: "save",
                message: `Could not save queued thread lifecycle commands: ${String(cause)}`,
              }),
          ),
        );
    }),
  });
});

export const layer = Layer.effect(ThreadLifecycleOutboxStore, make());
