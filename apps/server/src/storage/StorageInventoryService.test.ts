import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  EventId,
  ProviderInstanceId,
  StoragePathNotManagedError,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { transferProjection } from "../project/ProjectTransfer.testkit.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as StorageInventoryService from "./StorageInventoryService.ts";

const StoresLayer = Layer.mergeAll(ProjectStore.layer, ProjectionStore.layer).pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);
const StorageLayer = StorageInventoryService.layer.pipe(
  Layer.provideMerge(StoresLayer),
  Layer.provide(
    Layer.mock(VcsProcess.VcsProcess)({
      run: () =>
        Effect.succeed({
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
    }),
  ),
);
const TestLayer = StorageLayer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-storage-inventory-" })),
  Layer.provideMerge(NodeServices.layer),
);

const addProject = Effect.fn("addStorageProject")(function* (workspaceRoot: string) {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projectId = ProjectId.make("project-1");
  yield* projects.apply({
    sequence: 1,
    eventId: EventId.make("storage-project-created"),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: "2026-03-24T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "project.created",
    payload: {
      projectId,
      title: "App",
      workspaceRoot,
      defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      scripts: [],
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
    },
  });
});
const addThread = Effect.fn("addStorageThread")(function* (
  id: string,
  title: string,
  branch: string,
  worktreePath: string,
) {
  const threads = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = ThreadId.make(id);
  const now = DateTime.makeUnsafe("2026-03-24T00:00:00.000Z");
  yield* threads.apply({
    id: EventId.make(`storage-created:${id}`),
    type: "thread.created",
    threadId,
    occurredAt: now,
    payload: {
      ...transferProjection(threadId).thread,
      projectId: ProjectId.make("project-1"),
      title,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      branch,
      worktreePath,
      createdAt: now,
      updatedAt: now,
      settledOverride: "settled",
      settledAt: now,
    },
  });
});

const writeCheckout = Effect.fn("writeCheckout")(function* (target: string, contents: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(target, { recursive: true });
  yield* fileSystem.writeFileString(path.join(target, ".git"), "gitdir: /repo/.git/worktrees/x\n");
  yield* fileSystem.writeFileString(path.join(target, "readme"), contents);
});

it.layer(TestLayer, { excludeTestServices: true })("StorageInventoryService", (it) => {
  describe("getInventory", () => {
    it.effect("lists owned managed worktrees and residual orphans, never project checkouts", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const path = yield* Path.Path;
        const storage = yield* StorageInventoryService.StorageInventoryService;

        const featurePath = path.join(config.worktreesDir, "app", "feature");
        const orphanPath = path.join(config.worktreesDir, "app", "stale");
        const projectCheckout = path.join(config.baseDir, "projects", "app");
        yield* writeCheckout(featurePath, "owned\n");
        yield* writeCheckout(orphanPath, "leftover\n");
        yield* writeCheckout(projectCheckout, "project\n");

        yield* addProject(projectCheckout);
        yield* addThread("thread-1", "Feature", "feature", featurePath);

        const inventory = yield* storage.getInventory();
        expect(inventory.activeWorktrees.map((entry) => entry.threadId)).toEqual(["thread-1"]);
        expect(inventory.activeWorktrees[0]?.canRemoveWorktree).toBe(true);
        expect(inventory.activeWorktrees[0]?.isDirty).toBe(false);
        expect(inventory.orphanWorktrees.map((entry) => entry.displayName)).toEqual(["stale"]);
        expect(inventory.activeWorktrees.some((entry) => entry.path === projectCheckout)).toBe(
          false,
        );
        expect(inventory.orphanWorktrees.some((entry) => entry.path === projectCheckout)).toBe(
          false,
        );
        expect(inventory.totalBytes).toBeGreaterThan(0);
        expect(inventory.scan?.status).toBe("complete");
      }),
    );

    it.effect("streams climbing byte totals before the scan finishes", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const path = yield* Path.Path;
        const storage = yield* StorageInventoryService.StorageInventoryService;

        const featurePath = path.join(config.worktreesDir, "app", "feature");
        const secondPath = path.join(config.worktreesDir, "app", "second");
        const orphanPath = path.join(config.worktreesDir, "app", "stale");
        const projectCheckout = path.join(config.baseDir, "projects", "app");
        yield* writeCheckout(featurePath, "owned\n");
        yield* writeCheckout(secondPath, "also-owned\n");
        yield* writeCheckout(orphanPath, "leftover\n");
        yield* writeCheckout(projectCheckout, "project\n");

        yield* addProject(projectCheckout);
        yield* addThread("thread-1", "Feature", "feature", featurePath);
        yield* addThread("thread-2", "Second", "second", secondPath);

        const snapshots = yield* Stream.runCollect(storage.streamInventory());
        expect(snapshots.length).toBeGreaterThan(1);
        expect(snapshots[0]?.scan?.status).toBe("scanning");
        expect(snapshots[0]?.scan?.measuredCount).toBe(0);
        const totals = snapshots.flatMap((entry) =>
          entry.scan === undefined ? [] : [entry.scan.totalCount],
        );
        expect(new Set(totals).size).toBe(1);
        expect(snapshots[snapshots.length - 1]?.scan?.status).toBe("complete");
        expect(snapshots[snapshots.length - 1]?.totalBytes).toBeGreaterThan(0);
        const measuredCounts = snapshots.flatMap((entry) =>
          entry.scan === undefined ? [] : [entry.scan.measuredCount],
        );
        expect(measuredCounts[0]).toBe(0);
        expect(measuredCounts[measuredCounts.length - 1]).toBeGreaterThan(0);
      }),
    );
  });

  describe("removeOrphan", () => {
    it.effect("refuses paths outside the managed worktrees folder", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const path = yield* Path.Path;
        const storage = yield* StorageInventoryService.StorageInventoryService;
        const outside = path.join(config.baseDir, "projects", "app");
        const error = yield* storage.removeOrphan({ path: outside }).pipe(Effect.flip);
        expect(error).toBeInstanceOf(StoragePathNotManagedError);
      }),
    );

    it.effect("deletes a strict descendant of the managed worktrees folder", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;
        const storage = yield* StorageInventoryService.StorageInventoryService;
        const orphanPath = path.join(config.worktreesDir, "app", "stale");
        yield* writeCheckout(orphanPath, "leftover\n");

        const removed = yield* storage.removeOrphan({ path: orphanPath });
        expect(removed).toEqual({ removed: true });
        expect(yield* fileSystem.exists(orphanPath)).toBe(false);
      }),
    );

    it.effect("refuses a descendant reached through a symlinked directory", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;
        const storage = yield* StorageInventoryService.StorageInventoryService;
        const outsidePath = path.join(config.baseDir, "outside", "stale");
        const linkedParent = path.join(config.worktreesDir, "linked-outside");
        yield* writeCheckout(outsidePath, "must-survive\n");
        yield* fileSystem.makeDirectory(config.worktreesDir, { recursive: true });
        yield* fileSystem.symlink(path.dirname(outsidePath), linkedParent);

        const requested = path.join(linkedParent, "stale");
        const error = yield* storage.removeOrphan({ path: requested }).pipe(Effect.flip);
        expect(error).toBeInstanceOf(StoragePathNotManagedError);
        expect(yield* fileSystem.exists(outsidePath)).toBe(true);
      }),
    );
  });
});
