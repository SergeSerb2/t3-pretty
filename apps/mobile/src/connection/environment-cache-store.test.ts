import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThreadDetailSnapshot,
  type VcsListRefsResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { type ClientCacheKind, MobileDatabase } from "../persistence/mobile-database";
import { make, THREAD_SNAPSHOT_CACHE_MAX_ENTRIES } from "./environment-cache-store";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const REFS: VcsListRefsResult = {
  refs: [
    {
      name: "main",
      current: true,
      isDefault: true,
      worktreePath: "/repo",
    },
  ],
  isRepo: true,
  hasPrimaryRemote: true,
  nextCursor: null,
  totalCount: 1,
};

function makeThreadSnapshot(threadId: string): OrchestrationThreadDetailSnapshot {
  return {
    snapshotSequence: 1,
    thread: {
      id: ThreadId.make(threadId),
      projectId: ProjectId.make("project-1"),
      title: `Thread ${threadId}`,
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      enabledSkillIds: [],
      latestTurn: null,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  };
}

function cacheId(environmentId: EnvironmentId, kind: ClientCacheKind, cacheKey: string) {
  return `${environmentId}:${kind}:${cacheKey}`;
}

function makeDatabase() {
  const values = new Map<string, string>();
  const updatedAt = new Map<string, number>();
  let clock = 0;
  const removed: Array<string> = [];
  const database = MobileDatabase.of({
    loadCache: (environmentId, kind, cacheKey) =>
      Effect.succeed(Option.fromUndefinedOr(values.get(cacheId(environmentId, kind, cacheKey)))),
    saveCache: (environmentId, kind, cacheKey, _schemaVersion, payload) =>
      Effect.sync(() => {
        const id = cacheId(environmentId, kind, cacheKey);
        values.set(id, payload);
        updatedAt.set(id, (clock += 1));
      }),
    removeCache: (environmentId, kind, cacheKey) =>
      Effect.sync(() => {
        const id = cacheId(environmentId, kind, cacheKey);
        removed.push(id);
        values.delete(id);
        updatedAt.delete(id);
      }),
    pruneThreadCache: (environmentId, keep) =>
      Effect.sync(() => {
        const prefix = `${environmentId}:thread:`;
        const ids = [...values.keys()].filter((key) => key.startsWith(prefix));
        // Same ordering as the SQLite query: updated_at DESC, cache_key ASC.
        ids.sort((left, right) => {
          const byUpdatedAt = (updatedAt.get(right) ?? 0) - (updatedAt.get(left) ?? 0);
          return byUpdatedAt !== 0 ? byUpdatedAt : left.localeCompare(right);
        });
        for (const id of ids.slice(keep)) {
          values.delete(id);
          updatedAt.delete(id);
        }
      }),
    clearCacheKind: (environmentId, kind) =>
      Effect.sync(() => {
        for (const key of values.keys()) {
          if (key.startsWith(`${environmentId}:${kind}:`)) values.delete(key);
        }
      }),
    clearEnvironmentCache: (environmentId) =>
      Effect.sync(() => {
        for (const key of values.keys()) {
          if (key.startsWith(`${environmentId}:`)) values.delete(key);
        }
      }),
    clearAllCaches: Effect.sync(() => values.clear()),
    inspectCaches: Effect.succeed([]),
    loadPreferencesJson: Effect.succeed(Option.none()),
    savePreferencesJson: () => Effect.void,
  });
  return { database, removed, values };
}

describe("mobile SQLite environment cache store", () => {
  it.effect("round-trips schema-validated VCS refs", () =>
    Effect.gen(function* () {
      const memory = makeDatabase();
      const store = yield* make().pipe(Effect.provideService(MobileDatabase, memory.database));

      yield* store.saveVcsRefs(ENVIRONMENT_ID, "/repo", REFS);

      expect(yield* store.loadVcsRefs(ENVIRONMENT_ID, "/repo")).toEqual(Option.some(REFS));
    }),
  );

  it.effect("deletes a corrupt cache record and treats it as a miss", () =>
    Effect.gen(function* () {
      const memory = makeDatabase();
      const store = yield* make().pipe(Effect.provideService(MobileDatabase, memory.database));
      const id = cacheId(ENVIRONMENT_ID, "vcs-refs", "/repo");
      memory.values.set(id, "{not-json");

      expect(yield* store.loadVcsRefs(ENVIRONMENT_ID, "/repo")).toEqual(Option.none());
      expect(memory.removed).toEqual([id]);
    }),
  );

  it.effect("removes one persisted VCS ref snapshot", () =>
    Effect.gen(function* () {
      const memory = makeDatabase();
      const store = yield* make().pipe(Effect.provideService(MobileDatabase, memory.database));
      yield* store.saveVcsRefs(ENVIRONMENT_ID, "/repo", REFS);

      yield* store.removeVcsRefs(ENVIRONMENT_ID, "/repo");

      expect(yield* store.loadVcsRefs(ENVIRONMENT_ID, "/repo")).toEqual(Option.none());
      expect(memory.removed).toContain(cacheId(ENVIRONMENT_ID, "vcs-refs", "/repo"));
    }),
  );

  it.effect("clears every persisted VCS ref snapshot in one environment", () =>
    Effect.gen(function* () {
      const memory = makeDatabase();
      const store = yield* make().pipe(Effect.provideService(MobileDatabase, memory.database));
      const otherEnvironmentId = EnvironmentId.make("environment-2");
      yield* store.saveVcsRefs(ENVIRONMENT_ID, "/repo", REFS);
      yield* store.saveVcsRefs(ENVIRONMENT_ID, "/repo-worktree", REFS);
      yield* store.saveVcsRefs(otherEnvironmentId, "/repo", REFS);

      yield* store.clearVcsRefs(ENVIRONMENT_ID);

      expect(yield* store.loadVcsRefs(ENVIRONMENT_ID, "/repo")).toEqual(Option.none());
      expect(yield* store.loadVcsRefs(ENVIRONMENT_ID, "/repo-worktree")).toEqual(Option.none());
      expect(yield* store.loadVcsRefs(otherEnvironmentId, "/repo")).toEqual(Option.some(REFS));
    }),
  );

  it.effect("clears one environment without touching another", () =>
    Effect.gen(function* () {
      const memory = makeDatabase();
      const store = yield* make().pipe(Effect.provideService(MobileDatabase, memory.database));
      const otherEnvironmentId = EnvironmentId.make("environment-2");
      yield* store.saveVcsRefs(ENVIRONMENT_ID, "/repo", REFS);
      yield* store.saveVcsRefs(otherEnvironmentId, "/repo", REFS);

      yield* store.clear(ENVIRONMENT_ID);

      expect(yield* store.loadVcsRefs(ENVIRONMENT_ID, "/repo")).toEqual(Option.none());
      expect(yield* store.loadVcsRefs(otherEnvironmentId, "/repo")).toEqual(Option.some(REFS));
    }),
  );

  it.effect("evicts the oldest thread snapshots beyond the per-environment bound", () =>
    Effect.gen(function* () {
      const memory = makeDatabase();
      const store = yield* make().pipe(Effect.provideService(MobileDatabase, memory.database));
      const otherEnvironmentId = EnvironmentId.make("environment-2");
      yield* store.saveVcsRefs(ENVIRONMENT_ID, "/repo", REFS);
      yield* store.saveThread(otherEnvironmentId, makeThreadSnapshot("thread-other"));

      for (let index = 1; index <= THREAD_SNAPSHOT_CACHE_MAX_ENTRIES + 1; index += 1) {
        yield* store.saveThread(ENVIRONMENT_ID, makeThreadSnapshot(`thread-${index}`));
      }

      // The oldest row is gone; the newest N remain.
      expect(yield* store.loadThread(ENVIRONMENT_ID, ThreadId.make("thread-1"))).toEqual(
        Option.none(),
      );
      for (let index = 2; index <= THREAD_SNAPSHOT_CACHE_MAX_ENTRIES + 1; index += 1) {
        const loaded = yield* store.loadThread(ENVIRONMENT_ID, ThreadId.make(`thread-${index}`));
        expect(Option.isSome(loaded)).toBe(true);
      }
      // Non-thread kinds and other environments are not pruned.
      expect(yield* store.loadVcsRefs(ENVIRONMENT_ID, "/repo")).toEqual(Option.some(REFS));
      expect(
        yield* store.loadThread(otherEnvironmentId, ThreadId.make("thread-other")),
      ).not.toEqual(Option.none());
    }),
  );

  it.effect("re-saving a thread refreshes its eviction recency", () =>
    Effect.gen(function* () {
      const memory = makeDatabase();
      const store = yield* make().pipe(Effect.provideService(MobileDatabase, memory.database));

      for (let index = 1; index <= THREAD_SNAPSHOT_CACHE_MAX_ENTRIES; index += 1) {
        yield* store.saveThread(ENVIRONMENT_ID, makeThreadSnapshot(`thread-${index}`));
      }
      yield* store.saveThread(ENVIRONMENT_ID, makeThreadSnapshot("thread-1"));
      yield* store.saveThread(ENVIRONMENT_ID, makeThreadSnapshot("thread-new"));

      // thread-1 was refreshed by the re-save, so thread-2 is now the oldest.
      expect(
        Option.isSome(yield* store.loadThread(ENVIRONMENT_ID, ThreadId.make("thread-1"))),
      ).toBe(true);
      expect(yield* store.loadThread(ENVIRONMENT_ID, ThreadId.make("thread-2"))).toEqual(
        Option.none(),
      );
      expect(
        Option.isSome(yield* store.loadThread(ENVIRONMENT_ID, ThreadId.make("thread-new"))),
      ).toBe(true);
    }),
  );
});
