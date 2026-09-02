import { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  type PendingThreadLifecycleEntry,
  PendingThreadLifecycleEntries,
  THREAD_LIFECYCLE_OUTBOX_MAX_JSON_LENGTH,
} from "./threadLifecycleOutboxModel.ts";

export class ThreadLifecycleOutboxPersistenceError extends Schema.TaggedErrorClass<ThreadLifecycleOutboxPersistenceError>()(
  "ThreadLifecycleOutboxPersistenceError",
  {
    operation: Schema.Literals(["load", "save"]),
    message: Schema.String,
  },
) {}

function memoryThreadLifecycleOutboxStore() {
  const memory = new Map<EnvironmentId, ReadonlyArray<PendingThreadLifecycleEntry>>();
  return {
    load: (environmentId: EnvironmentId) => Effect.succeed(memory.get(environmentId) ?? []),
    save: (environmentId: EnvironmentId, entries: ReadonlyArray<PendingThreadLifecycleEntry>) =>
      Effect.sync(() => {
        if (entries.length === 0) {
          memory.delete(environmentId);
        } else {
          memory.set(environmentId, entries);
        }
      }),
  };
}

export class ThreadLifecycleOutboxStore extends Context.Reference<{
  readonly load: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<
    ReadonlyArray<PendingThreadLifecycleEntry>,
    ThreadLifecycleOutboxPersistenceError
  >;
  readonly save: (
    environmentId: EnvironmentId,
    entries: ReadonlyArray<PendingThreadLifecycleEntry>,
  ) => Effect.Effect<void, ThreadLifecycleOutboxPersistenceError>;
}>("@t3tools/client-runtime/state/threadLifecycleOutboxStore", {
  defaultValue: memoryThreadLifecycleOutboxStore,
}) {}

const StoredPendingEntriesJsonString = Schema.String.check(
  Schema.isMaxLength(THREAD_LIFECYCLE_OUTBOX_MAX_JSON_LENGTH),
);
const PendingThreadLifecycleEntriesJson = Schema.fromJsonString(PendingThreadLifecycleEntries);
const decodeStoredJsonString = Schema.decodeUnknownEffect(StoredPendingEntriesJsonString);
const decodePendingEntriesJson = Schema.decodeUnknownEffect(PendingThreadLifecycleEntriesJson);
const encodePendingEntriesJson = Schema.encodeEffect(PendingThreadLifecycleEntriesJson);

export const decodeStoredPendingEntries = (input: unknown) =>
  decodeStoredJsonString(input).pipe(Effect.flatMap(decodePendingEntriesJson));

export const encodePendingEntries = (entries: PendingThreadLifecycleEntries) =>
  encodePendingEntriesJson(entries).pipe(Effect.flatMap(decodeStoredJsonString));
