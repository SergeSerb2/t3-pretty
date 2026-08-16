import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ProjectId, ThreadId } from "./baseSchemas.ts";
import { StorageInventory, StorageWorktreeEntry } from "./storage.ts";

const decodeInventory = Schema.decodeUnknownSync(StorageInventory);

describe("StorageInventory", () => {
  it("decodes a measured inventory with unique-path byte totals", () => {
    const entry: typeof StorageWorktreeEntry.Encoded = {
      threadId: ThreadId.make("thread-1"),
      threadTitle: "Feature",
      projectId: ProjectId.make("project-1"),
      projectName: "App",
      projectWorkspaceRoot: "/repo",
      branch: "feature/storage",
      path: "/tmp/worktrees/app/feature-storage",
      isArchived: false,
      isDirty: false,
      diskUsageBytes: 1024,
      setupStatus: "ready",
      canRemoveWorktree: true,
      ownerCount: 1,
    };

    const inventory = decodeInventory({
      activeWorktrees: [entry],
      archivedWorktrees: [],
      activeThreadsWithoutWorktree: 2,
      archivedThreadsWithoutWorktree: 0,
      orphanWorktrees: [
        {
          path: "/tmp/worktrees/app/orphan",
          displayName: "orphan",
          diskUsageBytes: 512,
        },
      ],
      activeWorktreeBytes: 1024,
      archivedWorktreeBytes: 0,
      orphanWorktreeBytes: 512,
      totalBytes: 1536,
      managedWorktreesRoot: "/tmp/worktrees",
    });

    expect(inventory.activeWorktrees).toHaveLength(1);
    expect(inventory.orphanWorktrees[0]?.displayName).toBe("orphan");
    expect(inventory.totalBytes).toBe(1536);
    expect(inventory.scan).toBeUndefined();
  });

  it("decodes incremental scan progress when a server streams a partial inventory", () => {
    const inventory = decodeInventory({
      activeWorktrees: [],
      archivedWorktrees: [],
      activeThreadsWithoutWorktree: 0,
      archivedThreadsWithoutWorktree: 0,
      orphanWorktrees: [],
      activeWorktreeBytes: 0,
      archivedWorktreeBytes: 0,
      orphanWorktreeBytes: 0,
      totalBytes: 0,
      managedWorktreesRoot: "/tmp/worktrees",
      scan: { status: "scanning", measuredCount: 2, totalCount: 8 },
    });

    expect(inventory.scan).toEqual({ status: "scanning", measuredCount: 2, totalCount: 8 });
  });
});
