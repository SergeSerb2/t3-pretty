import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ProviderInstanceId,
  StoragePathNotManagedError,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ServerConfig from "../config.ts";
import { ProjectionProjectRepositoryLive } from "../persistence/Layers/ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "../persistence/Layers/ProjectionThreads.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as StorageInventoryService from "./StorageInventoryService.ts";

const StorageLayer = StorageInventoryService.layer.pipe(
  Layer.provideMerge(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  ),
  Layer.provideMerge(
    ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
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

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(StorageLayer),
  Layer.provideMerge(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  ),
  Layer.provideMerge(
    ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-storage-inventory-" })),
  Layer.provideMerge(NodeServices.layer),
);

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
        const projects = yield* ProjectionProjectRepository;
        const threads = yield* ProjectionThreadRepository;
        const storage = yield* StorageInventoryService.StorageInventoryService;

        const featurePath = path.join(config.worktreesDir, "app", "feature");
        const orphanPath = path.join(config.worktreesDir, "app", "stale");
        const projectCheckout = path.join(config.baseDir, "projects", "app");
        yield* writeCheckout(featurePath, "owned\n");
        yield* writeCheckout(orphanPath, "leftover\n");
        yield* writeCheckout(projectCheckout, "project\n");

        yield* projects.upsert({
          projectId: ProjectId.make("project-1"),
          title: "App",
          workspaceRoot: projectCheckout,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          defaultThreadEnvMode: null,
          scripts: [],
          createdAt: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-24T00:00:00.000Z",
          deletedAt: null,
        });
        yield* threads.upsert({
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
          title: "Feature",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "feature",
          worktreePath: featurePath,
          enabledSkillIds: [],
          latestTurnId: null,
          createdAt: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-24T00:00:00.000Z",
          archivedAt: null,
          settledOverride: "settled",
          settledAt: "2026-03-24T00:00:00.000Z",
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt: null,
          latestUserMessageAt: null,
          pendingApprovalCount: 0,
          pendingUserInputCount: 0,
          hasActionableProposedPlan: 0,
          deletedAt: null,
        });

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
        const projects = yield* ProjectionProjectRepository;
        const threads = yield* ProjectionThreadRepository;
        const storage = yield* StorageInventoryService.StorageInventoryService;

        const featurePath = path.join(config.worktreesDir, "app", "feature");
        const secondPath = path.join(config.worktreesDir, "app", "second");
        const orphanPath = path.join(config.worktreesDir, "app", "stale");
        const projectCheckout = path.join(config.baseDir, "projects", "app");
        yield* writeCheckout(featurePath, "owned\n");
        yield* writeCheckout(secondPath, "also-owned\n");
        yield* writeCheckout(orphanPath, "leftover\n");
        yield* writeCheckout(projectCheckout, "project\n");

        yield* projects.upsert({
          projectId: ProjectId.make("project-1"),
          title: "App",
          workspaceRoot: projectCheckout,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          defaultThreadEnvMode: null,
          scripts: [],
          createdAt: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-24T00:00:00.000Z",
          deletedAt: null,
        });
        yield* threads.upsert({
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
          title: "Feature",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "feature",
          worktreePath: featurePath,
          enabledSkillIds: [],
          latestTurnId: null,
          createdAt: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-24T00:00:00.000Z",
          archivedAt: null,
          settledOverride: "settled",
          settledAt: "2026-03-24T00:00:00.000Z",
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt: null,
          latestUserMessageAt: null,
          pendingApprovalCount: 0,
          pendingUserInputCount: 0,
          hasActionableProposedPlan: 0,
          deletedAt: null,
        });
        yield* threads.upsert({
          threadId: ThreadId.make("thread-2"),
          projectId: ProjectId.make("project-1"),
          title: "Second",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "second",
          worktreePath: secondPath,
          enabledSkillIds: [],
          latestTurnId: null,
          createdAt: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-24T00:00:00.000Z",
          archivedAt: null,
          settledOverride: "settled",
          settledAt: "2026-03-24T00:00:00.000Z",
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt: null,
          latestUserMessageAt: null,
          pendingApprovalCount: 0,
          pendingUserInputCount: 0,
          hasActionableProposedPlan: 0,
          deletedAt: null,
        });

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
  });
});
