import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
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
  displayNameForPath,
  hasOwnedDescendant,
  isStrictDescendant,
  type StorageMeasuredWorktree,
  type StorageThreadSnapshot,
} from "./storageInventory.ts";

const ORPHAN_SCAN_MAX_DEPTH = 3;
const MEASURE_CONCURRENCY = 8;

interface OrphanCandidate {
  readonly path: string;
  readonly displayName: string;
  readonly looksLikeCheckout: boolean;
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
      return yield* Effect.promise(() => directoryOnDiskBytes(target, platform));
    },
  );

  const listDirectories: (root: string, maxDepth: number) => Effect.Effect<ReadonlyArray<string>> =
    Effect.fn("StorageInventoryService.listDirectories")(function* (root, maxDepth) {
      const results: string[] = [];
      const visit: (current: string, depth: number) => Effect.Effect<void> = Effect.fn(
        "StorageInventoryService.listDirectories.visit",
      )(function* (current, depth) {
        if (depth >= maxDepth) {
          return;
        }
        const names = yield* fileSystem
          .readDirectory(current)
          .pipe(Effect.orElseSucceed((): string[] => []));
        for (const name of names) {
          if (name.startsWith(".")) continue;
          const child = path.join(current, name);
          const info = yield* fileSystem.stat(child).pipe(Effect.orElseSucceed(() => null));
          if (info === null || info.type !== "Directory") continue;
          results.push(canonicalizeStoragePath(child));
          yield* visit(child, depth + 1);
        }
      });
      yield* visit(root, 0);
      return results;
    });

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

  const listOrphanCandidates: (
    ownedPaths: ReadonlySet<string>,
  ) => Effect.Effect<ReadonlyArray<OrphanCandidate>> = Effect.fn(
    "StorageInventoryService.listOrphanCandidates",
  )(function* (ownedPaths) {
    const rootExists = yield* pathExists(managedRoot);
    if (!rootExists) {
      return [] as OrphanCandidate[];
    }
    const candidates = yield* listDirectories(managedRoot, ORPHAN_SCAN_MAX_DEPTH);
    const orphans: OrphanCandidate[] = [];
    for (const candidate of candidates) {
      if (ownedPaths.has(candidate)) continue;
      if (hasOwnedDescendant(candidate, ownedPaths)) continue;
      const gitMarker = path.join(candidate, ".git");
      const looksLikeCheckout = yield* pathExists(gitMarker);
      const childNames = yield* fileSystem
        .readDirectory(candidate)
        .pipe(Effect.orElseSucceed((): string[] => []));
      const childDirs = yield* Effect.forEach(
        childNames.filter((name) => !name.startsWith(".")),
        (name) =>
          fileSystem.stat(path.join(candidate, name)).pipe(
            Effect.map((info) => info.type === "Directory"),
            Effect.orElseSucceed(() => false),
          ),
      );
      if (!looksLikeCheckout && childDirs.some(Boolean)) continue;
      orphans.push({
        path: candidate,
        displayName: displayNameForPath(candidate),
        looksLikeCheckout,
      });
    }
    return orphans;
  });

  const loadSnapshots: () => Effect.Effect<
    ReadonlyArray<StorageThreadSnapshot>,
    StorageInventoryError
  > = Effect.fn("StorageInventoryService.loadSnapshots")(function* () {
    const projectRows = yield* projects.listAll().pipe(
      Effect.mapError(
        (cause) =>
          new StorageInventoryError({
            operation: "StorageInventoryService.getInventory",
            detail: "Failed to list projects.",
            cause,
          }),
      ),
    );
    const snapshots: StorageThreadSnapshot[] = [];
    for (const project of projectRows) {
      if (project.deletedAt !== null) continue;
      const threadRows = yield* threads.listByProjectId({ projectId: project.projectId }).pipe(
        Effect.mapError(
          (cause) =>
            new StorageInventoryError({
              operation: "StorageInventoryService.getInventory",
              detail: "Failed to list threads.",
              cause,
            }),
        ),
      );
      for (const thread of threadRows) {
        if (thread.deletedAt !== null) continue;
        const rawPath = thread.worktreePath?.trim() ?? "";
        const canonicalPath = rawPath.length > 0 ? canonicalizeStoragePath(rawPath) : null;
        const managedPath =
          canonicalPath !== null && isStrictDescendant(canonicalPath, managedRoot)
            ? canonicalPath
            : null;
        snapshots.push({
          threadId: thread.threadId,
          threadTitle: thread.title,
          projectId: project.projectId,
          projectName: project.title,
          projectWorkspaceRoot: project.workspaceRoot,
          branch: thread.branch,
          worktreePath: managedPath,
          isArchived: thread.archivedAt !== null,
          canRemoveWorktree: canRemoveStorageThread({
            archivedAt: thread.archivedAt,
            settledOverride: thread.settledOverride,
            pendingApprovalCount: thread.pendingApprovalCount,
            pendingUserInputCount: thread.pendingUserInputCount,
          }),
        });
      }
    }
    return snapshots;
  });

  const scanInventory = Effect.fn("StorageInventoryService.scanInventory")(function* (
    onProgress: (inventory: StorageInventory) => Effect.Effect<void>,
  ) {
    const snapshots = yield* loadSnapshots();
    const managedPaths = [
      ...new Set(
        snapshots.flatMap((snapshot) =>
          snapshot.worktreePath === null ? [] : [snapshot.worktreePath],
        ),
      ),
    ];
    const measurements = new Map<string, StorageMeasuredWorktree>();
    const orphans: StorageOrphanEntry[] = [];

    const snapshot = (scan: StorageInventoryScan): StorageInventory =>
      assembleStorageInventory({
        snapshots,
        measurements: new Map(measurements),
        orphanWorktrees: [...orphans],
        managedWorktreesRoot: managedRoot,
        scan,
      });

    yield* onProgress(
      snapshot({ status: "scanning", measuredCount: 0, totalCount: managedPaths.length }),
    );

    yield* Effect.forEach(
      managedPaths,
      (worktreePath) =>
        Effect.gen(function* () {
          const measured = yield* measureWorktree(worktreePath);
          measurements.set(worktreePath, measured);
          yield* onProgress(
            snapshot({
              status: "scanning",
              measuredCount: measurements.size,
              totalCount: managedPaths.length,
            }),
          );
        }),
      { concurrency: MEASURE_CONCURRENCY },
    );

    const orphanCandidates = yield* listOrphanCandidates(new Set(managedPaths));
    const totalCount = managedPaths.length + orphanCandidates.length;
    yield* onProgress(
      snapshot({
        status: "scanning",
        measuredCount: measurements.size,
        totalCount,
      }),
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
          yield* onProgress(
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
    yield* onProgress(complete);
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
