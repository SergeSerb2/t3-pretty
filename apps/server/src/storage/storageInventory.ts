// Sync path helpers stay on node:path so inventory assembly stays Effect-free.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import type { StorageOrphanEntry, StorageWorktreeEntry } from "@t3tools/contracts";

export interface StorageInventoryAssembly {
  readonly activeWorktrees: ReadonlyArray<StorageWorktreeEntry>;
  readonly archivedWorktrees: ReadonlyArray<StorageWorktreeEntry>;
  readonly activeThreadsWithoutWorktree: number;
  readonly archivedThreadsWithoutWorktree: number;
  readonly orphanWorktrees: ReadonlyArray<StorageOrphanEntry>;
  readonly activeWorktreeBytes: number;
  readonly archivedWorktreeBytes: number;
  readonly orphanWorktreeBytes: number;
  readonly totalBytes: number;
  readonly managedWorktreesRoot: string;
}

export interface StorageThreadSnapshot {
  readonly threadId: StorageWorktreeEntry["threadId"];
  readonly threadTitle: string;
  readonly projectId: StorageWorktreeEntry["projectId"];
  readonly projectName: string;
  readonly projectWorkspaceRoot: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly isArchived: boolean;
  readonly canRemoveWorktree: boolean;
}

export interface StorageMeasuredWorktree {
  readonly path: string;
  readonly diskUsageBytes: number;
  readonly isDirty: boolean | null;
  readonly setupStatus: StorageWorktreeEntry["setupStatus"];
}

function uniquePathBytes(
  entries: ReadonlyArray<{ readonly path: string; readonly diskUsageBytes: number }>,
): number {
  const seen = new Map<string, number>();
  for (const entry of entries) {
    if (!seen.has(entry.path)) {
      seen.set(entry.path, entry.diskUsageBytes);
    }
  }
  let total = 0;
  for (const bytes of seen.values()) {
    total += bytes;
  }
  return total;
}

export function canonicalizeStoragePath(value: string): string {
  return NodePath.normalize(NodePath.resolve(value));
}

export function isWithinManagedRoot(candidate: string, root: string): boolean {
  const relative = NodePath.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
}

export function isStrictDescendant(candidate: string, root: string): boolean {
  const relative = NodePath.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !NodePath.isAbsolute(relative);
}

export function displayNameForPath(path: string): string {
  const name = NodePath.basename(path).trim();
  return name.length > 0 ? name : path;
}

export function hasOwnedDescendant(path: string, ownedPaths: ReadonlySet<string>): boolean {
  if (ownedPaths.has(path)) {
    return true;
  }
  const prefix = path.endsWith(NodePath.sep) ? path : `${path}${NodePath.sep}`;
  for (const owned of ownedPaths) {
    if (owned.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export function canRemoveStorageThread(input: {
  readonly archivedAt: string | null;
  readonly settledOverride: "settled" | "active" | null;
  readonly pendingApprovalCount: number;
  readonly pendingUserInputCount: number;
}): boolean {
  if (input.pendingApprovalCount > 0 || input.pendingUserInputCount > 0) {
    return false;
  }
  if (input.settledOverride === "active") {
    return false;
  }
  return input.settledOverride === "settled" || input.archivedAt !== null;
}

function ownerCountByPath(snapshots: ReadonlyArray<StorageThreadSnapshot>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const snapshot of snapshots) {
    const path = snapshot.worktreePath;
    if (path === null) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

function sortWorktrees(left: StorageWorktreeEntry, right: StorageWorktreeEntry): number {
  if (left.diskUsageBytes !== right.diskUsageBytes) {
    return right.diskUsageBytes - left.diskUsageBytes;
  }
  const title = left.threadTitle.localeCompare(right.threadTitle, undefined, {
    sensitivity: "base",
  });
  if (title !== 0) return title;
  return left.threadId.localeCompare(right.threadId);
}

function sortOrphans(left: StorageOrphanEntry, right: StorageOrphanEntry): number {
  if (left.diskUsageBytes !== right.diskUsageBytes) {
    return right.diskUsageBytes - left.diskUsageBytes;
  }
  return left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
}

export function assembleStorageInventory(input: {
  readonly snapshots: ReadonlyArray<StorageThreadSnapshot>;
  readonly measurements: ReadonlyMap<string, StorageMeasuredWorktree>;
  readonly orphanWorktrees: ReadonlyArray<StorageOrphanEntry>;
  readonly managedWorktreesRoot: string;
}): StorageInventoryAssembly {
  const ownerCounts = ownerCountByPath(input.snapshots);
  const active: StorageWorktreeEntry[] = [];
  const archived: StorageWorktreeEntry[] = [];
  const ownedIds = new Set<string>();

  for (const snapshot of input.snapshots) {
    const path = snapshot.worktreePath;
    if (path === null) continue;
    const measurement = input.measurements.get(path);
    if (measurement === undefined) continue;
    ownedIds.add(snapshot.threadId);
    const entry: StorageWorktreeEntry = {
      threadId: snapshot.threadId,
      threadTitle: snapshot.threadTitle,
      projectId: snapshot.projectId,
      projectName: snapshot.projectName,
      projectWorkspaceRoot: snapshot.projectWorkspaceRoot,
      branch: snapshot.branch,
      path,
      isArchived: snapshot.isArchived,
      isDirty: measurement.isDirty,
      diskUsageBytes: measurement.diskUsageBytes,
      setupStatus: measurement.setupStatus,
      canRemoveWorktree: snapshot.canRemoveWorktree,
      ownerCount: ownerCounts.get(path) ?? 1,
    };
    if (snapshot.isArchived) {
      archived.push(entry);
    } else {
      active.push(entry);
    }
  }

  active.sort(sortWorktrees);
  archived.sort(sortWorktrees);
  const orphans = [...input.orphanWorktrees].sort(sortOrphans);

  const activeWorktreeBytes = uniquePathBytes(active);
  const archivedWorktreeBytes = uniquePathBytes(
    archived.filter((entry) => !active.some((activeEntry) => activeEntry.path === entry.path)),
  );
  const orphanWorktreeBytes = uniquePathBytes(orphans);
  const activeWithout = input.snapshots.filter(
    (snapshot) => !snapshot.isArchived && !ownedIds.has(snapshot.threadId),
  ).length;
  const archivedWithout = input.snapshots.filter(
    (snapshot) => snapshot.isArchived && !ownedIds.has(snapshot.threadId),
  ).length;

  return {
    activeWorktrees: active,
    archivedWorktrees: archived,
    activeThreadsWithoutWorktree: activeWithout,
    archivedThreadsWithoutWorktree: archivedWithout,
    orphanWorktrees: orphans,
    activeWorktreeBytes,
    archivedWorktreeBytes,
    orphanWorktreeBytes,
    totalBytes: activeWorktreeBytes + archivedWorktreeBytes + orphanWorktreeBytes,
    managedWorktreesRoot: input.managedWorktreesRoot,
  };
}

export function removableSettledWorktrees(
  inventory: Pick<StorageInventoryAssembly, "activeWorktrees" | "archivedWorktrees">,
  options: { readonly cleanOnly: boolean },
): ReadonlyArray<StorageWorktreeEntry> {
  return [...inventory.activeWorktrees, ...inventory.archivedWorktrees].filter((entry) => {
    if (!entry.canRemoveWorktree) return false;
    if (options.cleanOnly) return entry.isDirty === false;
    return true;
  });
}

/**
 * Paths that should be deleted from disk after clearing the given threads.
 * A shared checkout stays if any remaining thread still owns it.
 */
export function diskPathsReleasedByRemoval(
  inventory: Pick<StorageInventoryAssembly, "activeWorktrees" | "archivedWorktrees">,
  threadIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const remaining = new Map<string, number>();
  for (const entry of [...inventory.activeWorktrees, ...inventory.archivedWorktrees]) {
    if (threadIds.has(entry.threadId)) continue;
    remaining.set(entry.path, (remaining.get(entry.path) ?? 0) + 1);
  }
  const released = new Set<string>();
  for (const entry of [...inventory.activeWorktrees, ...inventory.archivedWorktrees]) {
    if (!threadIds.has(entry.threadId)) continue;
    if ((remaining.get(entry.path) ?? 0) === 0) {
      released.add(entry.path);
    }
  }
  return released;
}
