import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assembleStorageInventory,
  canRemoveStorageThread,
  diskPathsReleasedByRemoval,
  hasOwnedDescendant,
  isStrictDescendant,
  isWithinManagedRoot,
  removableSettledWorktrees,
  shouldPublishStorageProgress,
  storagePathsOverlap,
  type StorageMeasuredWorktree,
  type StorageThreadSnapshot,
} from "./storageInventory.ts";

function snapshot(
  input: Partial<StorageThreadSnapshot> & Pick<StorageThreadSnapshot, "threadId" | "worktreePath">,
): StorageThreadSnapshot {
  return {
    threadTitle: input.threadTitle ?? String(input.threadId),
    projectId: input.projectId ?? ProjectId.make("project-1"),
    projectName: input.projectName ?? "App",
    projectWorkspaceRoot: input.projectWorkspaceRoot ?? "/repo",
    branch: input.branch ?? "main",
    isArchived: input.isArchived ?? false,
    canRemoveWorktree: input.canRemoveWorktree ?? true,
    ...input,
  };
}

function measurement(
  path: string,
  bytes: number,
  extra: Partial<StorageMeasuredWorktree> = {},
): StorageMeasuredWorktree {
  return {
    path,
    diskUsageBytes: bytes,
    isDirty: false,
    setupStatus: "ready",
    ...extra,
  };
}

describe("storage progress publishing", () => {
  it("forces the first and last frames and coalesces the ones in between", () => {
    expect(shouldPublishStorageProgress(0, 10, true, 250)).toBe(true);
    expect(shouldPublishStorageProgress(0, 10, false, 250)).toBe(false);
    expect(shouldPublishStorageProgress(0, 250, false, 250)).toBe(true);
  });
});

describe("storage inventory assembly", () => {
  it("splits active and archived worktrees and counts threads without managed checkouts", () => {
    const activePath = "/tmp/worktrees/app/feature";
    const archivedPath = "/tmp/worktrees/app/old";
    const inventory = assembleStorageInventory({
      snapshots: [
        snapshot({ threadId: ThreadId.make("t-active"), worktreePath: activePath }),
        snapshot({
          threadId: ThreadId.make("t-archived"),
          worktreePath: archivedPath,
          isArchived: true,
        }),
        snapshot({ threadId: ThreadId.make("t-local"), worktreePath: null }),
        snapshot({
          threadId: ThreadId.make("t-archived-empty"),
          worktreePath: null,
          isArchived: true,
        }),
      ],
      measurements: new Map([
        [activePath, measurement(activePath, 1024)],
        [archivedPath, measurement(archivedPath, 2048)],
      ]),
      orphanWorktrees: [
        { path: "/tmp/worktrees/app/orphan", displayName: "orphan", diskUsageBytes: 512 },
      ],
      managedWorktreesRoot: "/tmp/worktrees",
    });

    expect(inventory.activeWorktrees.map((entry) => entry.threadId)).toEqual(["t-active"]);
    expect(inventory.archivedWorktrees.map((entry) => entry.threadId)).toEqual(["t-archived"]);
    expect(inventory.activeThreadsWithoutWorktree).toBe(1);
    expect(inventory.archivedThreadsWithoutWorktree).toBe(1);
    expect(inventory.activeWorktreeBytes).toBe(1024);
    expect(inventory.archivedWorktreeBytes).toBe(2048);
    expect(inventory.orphanWorktreeBytes).toBe(512);
    expect(inventory.totalBytes).toBe(1024 + 2048 + 512);
  });

  it("does not treat unmeasured owners as threads without a worktree", () => {
    const pending = "/tmp/worktrees/app/pending";
    const inventory = assembleStorageInventory({
      snapshots: [
        snapshot({ threadId: ThreadId.make("pending"), worktreePath: pending }),
        snapshot({ threadId: ThreadId.make("local"), worktreePath: null }),
        snapshot({
          threadId: ThreadId.make("archived-empty"),
          worktreePath: null,
          isArchived: true,
        }),
      ],
      measurements: new Map(),
      orphanWorktrees: [],
      managedWorktreesRoot: "/tmp/worktrees",
      scan: { status: "scanning", measuredCount: 0, totalCount: 1 },
    });

    expect(inventory.activeWorktrees).toEqual([]);
    expect(inventory.activeThreadsWithoutWorktree).toBe(1);
    expect(inventory.archivedThreadsWithoutWorktree).toBe(1);
  });

  it("counts a shared checkout once in byte totals", () => {
    const shared = "/tmp/worktrees/app/shared";
    const inventory = assembleStorageInventory({
      snapshots: [
        snapshot({ threadId: ThreadId.make("a"), worktreePath: shared }),
        snapshot({ threadId: ThreadId.make("b"), worktreePath: shared }),
      ],
      measurements: new Map([[shared, measurement(shared, 4096)]]),
      orphanWorktrees: [],
      managedWorktreesRoot: "/tmp/worktrees",
    });

    expect(inventory.activeWorktrees).toHaveLength(2);
    expect(inventory.activeWorktrees.every((entry) => entry.ownerCount === 2)).toBe(true);
    expect(inventory.activeWorktreeBytes).toBe(4096);
    expect(inventory.totalBytes).toBe(4096);
  });

  it("attributes an active and archived shared checkout only once", () => {
    const shared = "/tmp/worktrees/app/shared";
    const inventory = assembleStorageInventory({
      snapshots: [
        snapshot({ threadId: ThreadId.make("active"), worktreePath: shared }),
        snapshot({
          threadId: ThreadId.make("archived"),
          worktreePath: shared,
          isArchived: true,
        }),
      ],
      measurements: new Map([[shared, measurement(shared, 4096)]]),
      orphanWorktrees: [],
      managedWorktreesRoot: "/tmp/worktrees",
    });

    expect(inventory.activeWorktreeBytes).toBe(4096);
    expect(inventory.archivedWorktreeBytes).toBe(0);
    expect(inventory.totalBytes).toBe(4096);
  });

  it("saturates byte totals at the largest safe wire integer", () => {
    const activePath = "/tmp/worktrees/app/active";
    const inventory = assembleStorageInventory({
      snapshots: [snapshot({ threadId: ThreadId.make("active"), worktreePath: activePath })],
      measurements: new Map([[activePath, measurement(activePath, Number.MAX_SAFE_INTEGER)]]),
      orphanWorktrees: [
        { path: "/tmp/worktrees/app/orphan", displayName: "orphan", diskUsageBytes: 1 },
      ],
      managedWorktreesRoot: "/tmp/worktrees",
    });

    expect(inventory.totalBytes).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("filters removable settled lists and never treats unknown dirty as clean", () => {
    const clean = "/tmp/worktrees/app/clean";
    const dirty = "/tmp/worktrees/app/dirty";
    const unknown = "/tmp/worktrees/app/unknown";
    const running = "/tmp/worktrees/app/running";
    const inventory = assembleStorageInventory({
      snapshots: [
        snapshot({
          threadId: ThreadId.make("clean"),
          worktreePath: clean,
          canRemoveWorktree: true,
        }),
        snapshot({
          threadId: ThreadId.make("dirty"),
          worktreePath: dirty,
          canRemoveWorktree: true,
        }),
        snapshot({
          threadId: ThreadId.make("unknown"),
          worktreePath: unknown,
          canRemoveWorktree: true,
        }),
        snapshot({
          threadId: ThreadId.make("running"),
          worktreePath: running,
          canRemoveWorktree: false,
        }),
      ],
      measurements: new Map([
        [clean, measurement(clean, 100, { isDirty: false })],
        [dirty, measurement(dirty, 200, { isDirty: true })],
        [unknown, measurement(unknown, 300, { isDirty: null })],
        [running, measurement(running, 400, { isDirty: false })],
      ]),
      orphanWorktrees: [],
      managedWorktreesRoot: "/tmp/worktrees",
    });

    expect(
      removableSettledWorktrees(inventory, { cleanOnly: true }).map((entry) => entry.threadId),
    ).toEqual(["clean"]);
    expect(
      removableSettledWorktrees(inventory, { cleanOnly: false })
        .map((entry) => entry.threadId)
        .toSorted(),
    ).toEqual(["clean", "dirty", "unknown"]);
  });

  it("keeps a shared checkout on disk until every owning thread is removed", () => {
    const shared = "/tmp/worktrees/app/shared";
    const solo = "/tmp/worktrees/app/solo";
    const inventory = assembleStorageInventory({
      snapshots: [
        snapshot({ threadId: ThreadId.make("a"), worktreePath: shared }),
        snapshot({ threadId: ThreadId.make("b"), worktreePath: shared }),
        snapshot({ threadId: ThreadId.make("c"), worktreePath: solo }),
      ],
      measurements: new Map([
        [shared, measurement(shared, 10)],
        [solo, measurement(solo, 20)],
      ]),
      orphanWorktrees: [],
      managedWorktreesRoot: "/tmp/worktrees",
    });

    expect([...diskPathsReleasedByRemoval(inventory, new Set(["a"]))]).toEqual([]);
    expect([...diskPathsReleasedByRemoval(inventory, new Set(["a", "b"]))].toSorted()).toEqual([
      shared,
    ]);
    expect([...diskPathsReleasedByRemoval(inventory, new Set(["c"]))]).toEqual([solo]);
  });
});

describe("storage path sandbox", () => {
  it("accepts descendants of the managed root and rejects siblings", () => {
    expect(isWithinManagedRoot("/tmp/worktrees", "/tmp/worktrees")).toBe(true);
    expect(isStrictDescendant("/tmp/worktrees/app/leaf", "/tmp/worktrees")).toBe(true);
    expect(isStrictDescendant("/tmp/worktrees", "/tmp/worktrees")).toBe(false);
    expect(isWithinManagedRoot("/tmp/project-checkout", "/tmp/worktrees")).toBe(false);
    expect(isWithinManagedRoot("/tmp/worktrees-extra/leaf", "/tmp/worktrees")).toBe(false);
  });

  it("treats project containers that still hold owned leaves as owned", () => {
    const owned = new Set(["/tmp/worktrees/app/feature"]);
    expect(hasOwnedDescendant("/tmp/worktrees/app", owned)).toBe(true);
    expect(hasOwnedDescendant("/tmp/worktrees/other", owned)).toBe(false);
  });

  it("detects deletion overlap in either direction", () => {
    expect(storagePathsOverlap("/tmp/worktrees/app", "/tmp/worktrees/app/feature")).toBe(true);
    expect(storagePathsOverlap("/tmp/worktrees/app/feature", "/tmp/worktrees/app")).toBe(true);
    expect(storagePathsOverlap("/tmp/worktrees/app/feature", "/tmp/worktrees/app/feature")).toBe(
      true,
    );
    expect(storagePathsOverlap("/tmp/worktrees/app/one", "/tmp/worktrees/app/two")).toBe(false);
  });
});

describe("canRemoveStorageThread", () => {
  it("allows explicitly settled or archived threads and blocks pending work", () => {
    expect(
      canRemoveStorageThread({
        archivedAt: null,
        settledOverride: "settled",
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
      }),
    ).toBe(true);
    expect(
      canRemoveStorageThread({
        archivedAt: "2026-01-01T00:00:00.000Z",
        settledOverride: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
      }),
    ).toBe(true);
    expect(
      canRemoveStorageThread({
        archivedAt: null,
        settledOverride: "settled",
        pendingApprovalCount: 1,
        pendingUserInputCount: 0,
      }),
    ).toBe(false);
    expect(
      canRemoveStorageThread({
        archivedAt: null,
        settledOverride: "active",
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
      }),
    ).toBe(false);
    expect(
      canRemoveStorageThread({
        archivedAt: null,
        settledOverride: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
      }),
    ).toBe(false);
  });
});
