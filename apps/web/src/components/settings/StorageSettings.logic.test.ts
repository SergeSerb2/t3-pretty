import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type StorageInventory,
  type StorageWorktreeEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  archivedDeleteDetail,
  cleanSettledWorktrees,
  cleanupDetail,
  diskPathsReleasedByRemoval,
  formatStorageBytes,
  isStorageScanInProgress,
  pendingActionCopy,
  pluralCount,
  resolveSelectedStorageEnvironmentId,
  scanProgressCaption,
  settledWorktrees,
  sortStorageEnvironments,
  storageDeviceStatusText,
  STORAGE_SETTINGS_ROW_BATCH_SIZE,
  storageInventoryCoverageWarning,
  storageSettingsRowWindow,
  summaryCaption,
  uniqueWorktreeBytes,
  worktreeRowDescription,
  worktreeShouldForceRemove,
} from "./StorageSettings.logic";

function entry(
  input: Partial<StorageWorktreeEntry> & Pick<StorageWorktreeEntry, "threadId" | "path">,
): StorageWorktreeEntry {
  return {
    threadTitle: input.threadTitle ?? String(input.threadId),
    projectId: input.projectId ?? ProjectId.make("project-1"),
    projectName: input.projectName ?? "App",
    projectWorkspaceRoot: input.projectWorkspaceRoot ?? "/repo",
    branch: input.branch ?? "main",
    isArchived: input.isArchived ?? false,
    isDirty: input.isDirty ?? false,
    diskUsageBytes: input.diskUsageBytes ?? 1024,
    setupStatus: input.setupStatus ?? "ready",
    canRemoveWorktree: input.canRemoveWorktree ?? true,
    ownerCount: input.ownerCount ?? 1,
    ...input,
  };
}

const inventory: StorageInventory = {
  activeWorktrees: [
    entry({
      threadId: ThreadId.make("clean"),
      path: "/wt/clean",
      diskUsageBytes: 100,
      isDirty: false,
    }),
    entry({
      threadId: ThreadId.make("dirty"),
      path: "/wt/dirty",
      diskUsageBytes: 200,
      isDirty: true,
      canRemoveWorktree: true,
    }),
    entry({
      threadId: ThreadId.make("active"),
      path: "/wt/active",
      diskUsageBytes: 50,
      canRemoveWorktree: false,
    }),
  ],
  archivedWorktrees: [
    entry({
      threadId: ThreadId.make("archived"),
      path: "/wt/archived",
      diskUsageBytes: 300,
      isArchived: true,
    }),
  ],
  activeThreadsWithoutWorktree: 1,
  archivedThreadsWithoutWorktree: 2,
  orphanWorktrees: [{ path: "/wt/orphan", displayName: "orphan", diskUsageBytes: 40 }],
  activeWorktreeBytes: 350,
  archivedWorktreeBytes: 300,
  orphanWorktreeBytes: 40,
  totalBytes: 690,
  managedWorktreesRoot: "/wt",
};

describe("storage settings helpers", () => {
  it("reveals high-cardinality inventory rows in bounded batches", () => {
    expect(storageSettingsRowWindow(4_096, STORAGE_SETTINGS_ROW_BATCH_SIZE)).toEqual({
      visibleCount: STORAGE_SETTINGS_ROW_BATCH_SIZE,
      remainingCount: 4_096 - STORAGE_SETTINGS_ROW_BATCH_SIZE,
    });
    expect(storageSettingsRowWindow(4_096, STORAGE_SETTINGS_ROW_BATCH_SIZE * 2)).toEqual({
      visibleCount: STORAGE_SETTINGS_ROW_BATCH_SIZE * 2,
      remainingCount: 4_096 - STORAGE_SETTINGS_ROW_BATCH_SIZE * 2,
    });
    expect(storageSettingsRowWindow(12, Number.POSITIVE_INFINITY)).toEqual({
      visibleCount: 12,
      remainingCount: 0,
    });
  });

  it("formats byte sizes", () => {
    expect(formatStorageBytes(512)).toBe("512 B");
    expect(formatStorageBytes(2048)).toBe("2.00 KB");
    expect(formatStorageBytes(10 * 1024)).toBe("10.0 KB");
  });

  it("reports scan progress instead of a finished caption while bytes are still landing", () => {
    const scanning: StorageInventory = {
      ...inventory,
      totalBytes: 2048,
      scan: { status: "scanning", measuredCount: 3, totalCount: 12 },
    };
    expect(isStorageScanInProgress(null, true)).toBe(true);
    expect(isStorageScanInProgress(scanning, true)).toBe(true);
    expect(isStorageScanInProgress(scanning, false)).toBe(false);
    expect(isStorageScanInProgress(inventory, true)).toBe(true);
    expect(isStorageScanInProgress(inventory, false)).toBe(false);
    expect(
      isStorageScanInProgress(
        { ...scanning, scan: { status: "complete", measuredCount: 12, totalCount: 12 } },
        true,
      ),
    ).toBe(false);
    expect(scanProgressCaption(scanning)).toBe("Found 2.00 KB so far · 3 of 12 paths");
    expect(summaryCaption(scanning)).toBe("Found 2.00 KB so far · 3 of 12 paths");
    expect(summaryCaption(inventory)).toBe("4 worktrees measured");
  });

  it("explains incomplete discovery so bulk totals are not presented as exact", () => {
    const incomplete: StorageInventory = {
      ...inventory,
      scan: {
        status: "complete",
        measuredCount: 4,
        totalCount: 4,
        truncated: true,
        unreadableDirectories: 2,
      },
    };

    expect(storageInventoryCoverageWarning(incomplete)).toBe(
      "Inventory is incomplete: discovery reached a safety limit and 2 directories could not be read. Bulk cleanup is disabled; listed paths can still be removed individually.",
    );
  });

  it("treats unread git status as unsafe, never clean", () => {
    const unread = entry({
      threadId: ThreadId.make("unread"),
      path: "/wt/unread",
      isDirty: null,
      canRemoveWorktree: true,
    });
    expect(cleanSettledWorktrees({ activeWorktrees: [unread], archivedWorktrees: [] })).toEqual([]);
    expect(worktreeShouldForceRemove(unread)).toBe(true);
  });

  it("keeps activity-auto-settled trees out of bulk remove", () => {
    expect(cleanSettledWorktrees(inventory).map((item) => item.threadId)).toEqual([
      "clean",
      "archived",
    ]);
    expect(settledWorktrees(inventory).map((item) => item.threadId)).toEqual([
      "clean",
      "dirty",
      "archived",
    ]);
  });

  it("counts shared checkouts once and only releases a path when every owner is removed", () => {
    const shared = [
      entry({
        threadId: ThreadId.make("a"),
        path: "/wt/shared",
        ownerCount: 2,
        diskUsageBytes: 80,
      }),
      entry({
        threadId: ThreadId.make("b"),
        path: "/wt/shared",
        ownerCount: 2,
        diskUsageBytes: 80,
      }),
    ];
    expect(uniqueWorktreeBytes(shared)).toBe(80);
    expect([
      ...diskPathsReleasedByRemoval(
        { activeWorktrees: shared, archivedWorktrees: [] },
        new Set(["a"]),
      ),
    ]).toEqual([]);
    expect([
      ...diskPathsReleasedByRemoval(
        { activeWorktrees: shared, archivedWorktrees: [] },
        new Set(["a", "b"]),
      ),
    ]).toEqual(["/wt/shared"]);
  });

  it("writes cleanup and row copy", () => {
    expect(pluralCount(1, "worktree")).toBe("1 worktree");
    expect(cleanupDetail([], "none")).toBe("none");
    expect(archivedDeleteDetail(inventory)).toContain("1 archived thread");
    expect(worktreeRowDescription(inventory.activeWorktrees[1]!)).toContain("uncommitted changes");
    expect(pendingActionCopy({ kind: "remove-orphans" }).confirmLabel).toBe("Remove");
    expect(pendingActionCopy({ kind: "delete-archived" }).confirmLabel).toBe("Delete");
  });

  it("lists this device first, then remaining devices alphabetically", () => {
    const primary = { environmentId: EnvironmentId.make("env-1"), label: "Serge's Mac" };
    const remoteB = { environmentId: EnvironmentId.make("env-2"), label: "Box B" };
    const remoteA = { environmentId: EnvironmentId.make("env-3"), label: "Box A" };
    expect(sortStorageEnvironments([remoteB, remoteA], EnvironmentId.make("env-1"))).toEqual([
      remoteA,
      remoteB,
    ]);
    expect(sortStorageEnvironments([remoteB, primary, remoteA], primary.environmentId)).toEqual([
      primary,
      remoteA,
      remoteB,
    ]);
  });

  it("keeps a live pick, falls back to this device, then the first listed device", () => {
    const primary = { environmentId: EnvironmentId.make("env-1"), label: "Serge's Mac" };
    const remote = { environmentId: EnvironmentId.make("env-2"), label: "Box" };
    const listed = [primary, remote];
    expect(
      resolveSelectedStorageEnvironmentId(listed, remote.environmentId, primary.environmentId),
    ).toBe(remote.environmentId);
    expect(
      resolveSelectedStorageEnvironmentId(
        listed,
        EnvironmentId.make("env-gone"),
        primary.environmentId,
      ),
    ).toBe(primary.environmentId);
    expect(
      resolveSelectedStorageEnvironmentId([remote], EnvironmentId.make("env-gone"), null),
    ).toBe(remote.environmentId);
    expect(resolveSelectedStorageEnvironmentId([], null, null)).toBe(null);
  });

  it("summarizes a device as bytes once measured, otherwise its state", () => {
    expect(storageDeviceStatusText({ unsupported: false, error: null, inventory })).toBe(
      formatStorageBytes(inventory.totalBytes),
    );
    expect(storageDeviceStatusText({ unsupported: true, error: null, inventory: null })).toBe(
      "Server update needed",
    );
    expect(storageDeviceStatusText({ unsupported: false, error: "boom", inventory: null })).toBe(
      "Unavailable",
    );
    expect(storageDeviceStatusText({ unsupported: false, error: null, inventory: null })).toBe(
      "Measuring…",
    );
  });
});
