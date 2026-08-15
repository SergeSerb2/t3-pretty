import {
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
  pendingActionCopy,
  pluralCount,
  settledWorktrees,
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
  it("formats byte sizes", () => {
    expect(formatStorageBytes(512)).toBe("512 B");
    expect(formatStorageBytes(2048)).toBe("2.00 KB");
    expect(formatStorageBytes(10 * 1024)).toBe("10.0 KB");
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
});
