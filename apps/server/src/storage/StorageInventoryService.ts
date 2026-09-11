import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  STORAGE_INVENTORY_MAX_ENTRIES,
  type StorageInventory,
  type StorageInventoryScan,
  type StorageOrphanEntry,
  StorageInventoryError,
  StoragePathNotManagedError,
  type StorageRemoveOrphanResult,
  type StorageWorktreeSetupStatus,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { directoryOnDiskBytes } from "./directorySize.ts";
import {
  assembleStorageInventory,
  canRemoveStorageThread,
  canonicalizeStoragePath,
  isStrictDescendant,
  shouldPublishStorageProgress,
  storagePathsOverlap,
  type StorageMeasuredWorktree,
  type StorageThreadSnapshot,
} from "./storageInventory.ts";
import {
  discoverStorageOrphans,
  type StorageOrphanDiscoveryResult,
} from "./storageOrphanDiscovery.ts";

const ORPHAN_SCAN_MAX_DEPTH = 3;
const MEASURE_CONCURRENCY = 8;
/** Cap full-inventory progress frames so large scans do not serialize O(N²) entry payloads. */
const PROGRESS_MIN_INTERVAL_MS = 250;

interface LoadedStorageSnapshots {
  readonly snapshots: readonly StorageThreadSnapshot[];
  readonly activeThreadsWithoutWorktree: number;
  readonly archivedThreadsWithoutWorktree: number;
  readonly truncated: boolean;
}

const EMPTY_INVENTORY = (managedWorktreesRoot: string): StorageInventory => ({
  activeWorktrees: [],
  archivedWorktrees: [],
  activeThreadsWithoutWorktree: 0,
  archivedThreadsWithoutWorktree: 0,
  orphanWorktrees: [],
  activeWorktreeBytes: 0,
  archivedWorktreeBytes: 0,
  orphanWorktreeBytes: 0,
  totalBytes: 0,
  managedWorktreesRoot,
  scan: { status: "complete", measuredCount: 0, totalCount: 0 },
});

export class StorageInventoryService extends Context.Service<
  StorageInventoryService,
  {
    readonly getInventory: () => Effect.Effect<StorageInventory, StorageInventoryError>;
    readonly streamInventory: () => Stream.Stream<StorageInventory, StorageInventoryError>;
    readonly removeOrphan: (input: {
      readonly path: string;
    }) => Effect.Effect<
      StorageRemoveOrphanResult,
      StorageInventoryError | StoragePathNotManagedError
    >;
  }
>()("t3/storage/StorageInventoryService") {}

export const layerTest = Layer.succeed(
  StorageInventoryService,
  StorageInventoryService.of({
    getInventory: () => Effect.succeed(EMPTY_INVENTORY("/")),
    streamInventory: () => Stream.make(EMPTY_INVENTORY("/")),
    removeOrphan: () => Effect.succeed({ removed: false }),
  }),
);

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const projects = yield* ProjectionProjectRepository;
  const threads = yield* ProjectionThreadRepository;
  const vcsProcess = yield* VcsProcess.VcsProcess;
  const platform = yield* HostProcessPlatform;

  const managedRoot = canonicalizeStoragePath(config.worktreesDir);

  const pathExists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));

  const directoryAllocatedSize = Effect.fn("StorageInventoryService.directoryAllocatedSize")(
    function* (target: string) {
      return yield* Effect.promise((signal) => directoryOnDiskBytes(target, platform, signal));
    },
  );

  const measureWorktree: (worktreePath: string) => Effect.Effect<StorageMeasuredWorktree> =
    Effect.fn("StorageInventoryService.measureWorktree")(function* (worktreePath) {
      const exists = yield* pathExists(worktreePath);
      if (!exists) {
        return {
          path: worktreePath,
          diskUsageBytes: 0,
          isDirty: null,
          setupStatus: "missing" satisfies StorageWorktreeSetupStatus,
        };
      }
      const gitMarker = path.join(worktreePath, ".git");
      const looksLikeCheckout = yield* pathExists(gitMarker);
      const setupStatus: StorageWorktreeSetupStatus = looksLikeCheckout ? "ready" : "repair-needed";
      const diskUsageBytes = yield* directoryAllocatedSize(worktreePath);
      if (!looksLikeCheckout) {
        return { path: worktreePath, diskUsageBytes, isDirty: null, setupStatus };
      }
      const isDirty = yield* vcsProcess
        .run({
          operation: "StorageInventoryService.worktreeStatus",
          command: "git",
          args: ["status", "--porcelain"],
          cwd: worktreePath,
        })
        .pipe(
          Effect.map((result) => result.stdout.trim().length > 0),
          Effect.orElseSucceed((): boolean | null => null),
        );
      return { path: worktreePath, diskUsageBytes, isDirty, setupStatus };
    });

  const loadSnapshots: () => Effect.Effect<LoadedStorageSnapshots, StorageInventoryError> =
    Effect.fn("StorageInventoryService.loadSnapshots")(function* () {
      const [projectRows, threadRows] = yield* Effect.all(
        [
          projects.listAll().pipe(
            Effect.mapError(
              (cause) =>
                new StorageInventoryError({
                  operation: "StorageInventoryService.getInventory",
                  detail: "Failed to list projects.",
                  cause,
                }),
            ),
          ),
          threads.listAll().pipe(
            Effect.mapError(
              (cause) =>
                new StorageInventoryError({
                  operation: "StorageInventoryService.getInventory",
                  detail: "Failed to list threads.",
                  cause,
                }),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );
      const projectsById = new Map(
        projectRows
          .filter((project) => project.deletedAt === null)
          .map((project) => [project.projectId, project] as const),
      );
      const snapshots: StorageThreadSnapshot[] = [];
      let activeThreadsWithoutWorktree = 0;
      let archivedThreadsWithoutWorktree = 0;
      let truncated = false;
      for (const thread of threadRows) {
        if (thread.deletedAt !== null) continue;
        const project = projectsById.get(thread.projectId);
        if (project === undefined) continue;
        const rawPath = thread.worktreePath?.trim() ?? "";
        const canonicalPath = rawPath.length > 0 ? canonicalizeStoragePath(rawPath) : null;
        const managedPath =
          canonicalPath !== null && isStrictDescendant(canonicalPath, managedRoot)
            ? canonicalPath
            : null;
        const isArchived = thread.archivedAt !== null;
        if (managedPath === null) {
          if (isArchived) archivedThreadsWithoutWorktree += 1;
          else activeThreadsWithoutWorktree += 1;
          continue;
        }
        if (snapshots.length >= STORAGE_INVENTORY_MAX_ENTRIES) {
          truncated = true;
          continue;
        }
        snapshots.push({
          threadId: thread.threadId,
          threadTitle: thread.title,
          projectId: project.projectId,
          projectName: project.title,
          projectWorkspaceRoot: project.workspaceRoot,
          branch: thread.branch,
          worktreePath: managedPath,
          isArchived,
          canRemoveWorktree: canRemoveStorageThread({
            archivedAt: thread.archivedAt,
            settledOverride: thread.settledOverride,
            pendingApprovalCount: thread.pendingApprovalCount,
            pendingUserInputCount: thread.pendingUserInputCount,
          }),
        });
      }
      return {
        snapshots,
        activeThreadsWithoutWorktree,
        archivedThreadsWithoutWorktree,
        truncated,
      };
    });

  const scanInventory = Effect.fn("StorageInventoryService.scanInventory")(function* (
    onProgress: (inventory: StorageInventory) => Effect.Effect<void>,
  ) {
    const loaded = yield* loadSnapshots();
    const { snapshots } = loaded;
    const managedPaths = [
      ...new Set(
        snapshots.flatMap((snapshot) =>
          snapshot.worktreePath === null ? [] : [snapshot.worktreePath],
        ),
      ),
    ];
    const measurements = new Map<string, StorageMeasuredWorktree>();
    const orphans: StorageOrphanEntry[] = [];
    const rootExists = yield* pathExists(managedRoot);
    const orphanCapacity = loaded.truncated
      ? 0
      : Math.max(0, STORAGE_INVENTORY_MAX_ENTRIES - snapshots.length);
    const orphanDiscovery: StorageOrphanDiscoveryResult = rootExists
      ? yield* Effect.promise((signal) =>
          discoverStorageOrphans({
            root: managedRoot,
            ownedPaths: new Set(managedPaths),
            maxDepth: ORPHAN_SCAN_MAX_DEPTH,
            maxCandidates: orphanCapacity,
            signal,
          }),
        )
      : { candidates: [], truncated: false, unreadableDirectories: 0 };
    const orphanCandidates = orphanDiscovery.candidates;
    const totalCount = managedPaths.length + orphanCandidates.length;
    const scanMetadata = {
      ...(loaded.truncated || orphanDiscovery.truncated ? { truncated: true } : {}),
      ...(orphanDiscovery.unreadableDirectories > 0
        ? { unreadableDirectories: orphanDiscovery.unreadableDirectories }
        : {}),
    };

    const snapshot = (scan: StorageInventoryScan): StorageInventory =>
      assembleStorageInventory({
        snapshots,
        measurements: new Map(measurements),
        orphanWorktrees: [...orphans],
        activeThreadsWithoutWorktree: loaded.activeThreadsWithoutWorktree,
        archivedThreadsWithoutWorktree: loaded.archivedThreadsWithoutWorktree,
        managedWorktreesRoot: managedRoot,
        scan: { ...scan, ...scanMetadata },
      });

    let lastProgressAt = Number.NEGATIVE_INFINITY;
    const publish = (inventory: StorageInventory, force = false) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (!shouldPublishStorageProgress(lastProgressAt, now, force, PROGRESS_MIN_INTERVAL_MS)) {
          return;
        }
        lastProgressAt = now;
        yield* onProgress(inventory);
      });

    yield* publish(snapshot({ status: "scanning", measuredCount: 0, totalCount }), true);

    yield* Effect.forEach(
      managedPaths,
      (worktreePath) =>
        Effect.gen(function* () {
          const measured = yield* measureWorktree(worktreePath);
          measurements.set(worktreePath, measured);
          yield* publish(
            snapshot({
              status: "scanning",
              measuredCount: measurements.size,
              totalCount,
            }),
          );
        }),
      { concurrency: MEASURE_CONCURRENCY },
    );

    let measuredOrphans = 0;
    yield* Effect.forEach(
      orphanCandidates,
      (candidate) =>
        Effect.gen(function* () {
          const bytes = yield* directoryAllocatedSize(candidate.path);
          if (bytes > 0 || candidate.looksLikeCheckout) {
            orphans.push({
              path: candidate.path,
              displayName: candidate.displayName,
              diskUsageBytes: bytes,
            });
          }
          measuredOrphans += 1;
          yield* publish(
            snapshot({
              status: "scanning",
              measuredCount: measurements.size + measuredOrphans,
              totalCount,
            }),
          );
        }),
      { concurrency: MEASURE_CONCURRENCY },
    );

    const complete = snapshot({
      status: "complete",
      measuredCount: totalCount,
      totalCount,
    });
    yield* publish(complete, true);
    return complete;
  });

  const getInventory: StorageInventoryService["Service"]["getInventory"] = Effect.fn(
    "StorageInventoryService.getInventory",
  )(function* () {
    return yield* scanInventory(() => Effect.void);
  });

  const streamInventory: StorageInventoryService["Service"]["streamInventory"] = () =>
    Stream.callback<StorageInventory, StorageInventoryError>((queue) =>
      scanInventory((inventory) => Queue.offer(queue, inventory).pipe(Effect.asVoid)).pipe(
        Effect.catchTag("StorageInventoryError", (error) => Queue.fail(queue, error)),
        Effect.andThen(Queue.end(queue)),
        Effect.forkScoped,
      ),
    );

  const removeOrphan: StorageInventoryService["Service"]["removeOrphan"] = Effect.fn(
    "StorageInventoryService.removeOrphan",
  )(function* (input) {
    const target = canonicalizeStoragePath(input.path);
    if (!isStrictDescendant(target, managedRoot)) {
      return yield* new StoragePathNotManagedError({
        path: input.path,
        managedWorktreesRoot: managedRoot,
      });
    }
    const exists = yield* pathExists(target);
    if (!exists) {
      return { removed: true };
    }

    const resolveDeletionPath = (candidate: string, label: string) =>
      fileSystem.realPath(candidate).pipe(
        Effect.map(canonicalizeStoragePath),
        Effect.mapError(
          (cause) =>
            new StorageInventoryError({
              operation: "StorageInventoryService.removeOrphan",
              detail: `Failed to verify the ${label} path before removal.`,
              cause,
            }),
        ),
      );
    const realManagedRoot = yield* resolveDeletionPath(managedRoot, "managed worktrees root");
    const realTarget = yield* resolveDeletionPath(target, "requested orphan");
    const expectedRealTarget = canonicalizeStoragePath(
      path.resolve(realManagedRoot, path.relative(managedRoot, target)),
    );
    if (realTarget !== expectedRealTarget || !isStrictDescendant(realTarget, realManagedRoot)) {
      return yield* new StoragePathNotManagedError({
        path: input.path,
        managedWorktreesRoot: managedRoot,
      });
    }

    const loaded = yield* loadSnapshots();
    if (loaded.truncated) {
      return yield* new StorageInventoryError({
        operation: "StorageInventoryService.removeOrphan",
        detail: "Refused removal because the owned-worktree inventory was truncated.",
      });
    }
    const ownedPaths = [
      ...new Set(
        loaded.snapshots.flatMap((snapshot) =>
          snapshot.worktreePath === null ? [] : [snapshot.worktreePath],
        ),
      ),
    ];
    for (const ownedPath of ownedPaths) {
      if (storagePathsOverlap(target, ownedPath)) {
        return yield* new StorageInventoryError({
          operation: "StorageInventoryService.removeOrphan",
          detail: "Refused removal because the requested path overlaps an owned worktree.",
        });
      }
      const realOwnedPath = yield* fileSystem.realPath(ownedPath).pipe(
        Effect.map(canonicalizeStoragePath),
        Effect.orElseSucceed(() => ownedPath),
      );
      if (storagePathsOverlap(realTarget, realOwnedPath)) {
        return yield* new StorageInventoryError({
          operation: "StorageInventoryService.removeOrphan",
          detail: "Refused removal because the requested path resolves to an owned worktree.",
        });
      }
    }
    yield* fileSystem.remove(target, { recursive: true, force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new StorageInventoryError({
            operation: "StorageInventoryService.removeOrphan",
            detail: `Failed to remove ${target}.`,
            cause,
          }),
      ),
    );
    return { removed: true };
  });

  return { getInventory, streamInventory, removeOrphan } as const;
});

export const layer = Layer.effect(StorageInventoryService, make);
