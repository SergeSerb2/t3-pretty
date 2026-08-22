import type {
  EnvironmentId,
  StorageInventory,
  StorageOrphanEntry,
  StorageWorktreeEntry,
} from "@t3tools/contracts";

export interface StorageEnvironmentOptionLike {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

/**
 * Device picker order: this device first, then alphabetical. Catalog order is
 * insertion order, which can surface remote connections ahead of the system
 * the user is actually sitting at.
 */
export function sortStorageEnvironments<T extends StorageEnvironmentOptionLike>(
  environments: ReadonlyArray<T>,
  primaryEnvironmentId: EnvironmentId | null,
): ReadonlyArray<T> {
  return environments.toSorted((left, right) => {
    const leftIsPrimary = left.environmentId === primaryEnvironmentId;
    const rightIsPrimary = right.environmentId === primaryEnvironmentId;
    if (leftIsPrimary !== rightIsPrimary) {
      return leftIsPrimary ? -1 : 1;
    }
    return (
      left.label.localeCompare(right.label) ||
      String(left.environmentId).localeCompare(String(right.environmentId))
    );
  });
}

/**
 * Raw user intent wins while the picked environment is still listed; otherwise
 * fall back to this device, then the first listed device. Keeping the raw pick
 * means a device that briefly drops out restores the selection when it returns.
 */
export function resolveSelectedStorageEnvironmentId(
  environments: ReadonlyArray<StorageEnvironmentOptionLike>,
  selectedEnvironmentId: EnvironmentId | null,
  primaryEnvironmentId: EnvironmentId | null,
): EnvironmentId | null {
  if (
    selectedEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === selectedEnvironmentId)
  ) {
    return selectedEnvironmentId;
  }
  if (
    primaryEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === primaryEnvironmentId)
  ) {
    return primaryEnvironmentId;
  }
  return environments[0]?.environmentId ?? null;
}

/** Device picker subtitle: measured bytes once known, otherwise the environment's state. */
export function storageDeviceStatusText(environment: {
  readonly unsupported: boolean;
  readonly error: string | null;
  readonly inventory: Pick<StorageInventory, "totalBytes"> | null;
}): string {
  if (environment.inventory !== null) {
    return formatStorageBytes(environment.inventory.totalBytes);
  }
  if (environment.unsupported) return "Server update needed";
  if (environment.error !== null) return "Unavailable";
  return "Measuring…";
}

export function formatStorageBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"] as const;
  let unitIndex = -1;
  let next = value;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function pluralCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function uniqueWorktreeBytes(entries: ReadonlyArray<StorageWorktreeEntry>): number {
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

export function cleanSettledWorktrees(
  inventory: Pick<StorageInventory, "activeWorktrees" | "archivedWorktrees">,
): ReadonlyArray<StorageWorktreeEntry> {
  return [...inventory.activeWorktrees, ...inventory.archivedWorktrees].filter(
    (entry) => entry.canRemoveWorktree && entry.isDirty === false,
  );
}

export function settledWorktrees(
  inventory: Pick<StorageInventory, "activeWorktrees" | "archivedWorktrees">,
): ReadonlyArray<StorageWorktreeEntry> {
  return [...inventory.activeWorktrees, ...inventory.archivedWorktrees].filter(
    (entry) => entry.canRemoveWorktree,
  );
}

/**
 * Paths that should be deleted from disk after unlinking the given threads.
 * A shared checkout stays if any remaining thread still owns it.
 */
export function diskPathsReleasedByRemoval(
  inventory: Pick<StorageInventory, "activeWorktrees" | "archivedWorktrees">,
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

export function worktreeShouldForceRemove(entry: StorageWorktreeEntry): boolean {
  return entry.isDirty !== false;
}

export function cleanupDetail(entries: ReadonlyArray<StorageWorktreeEntry>, empty: string): string {
  if (entries.length === 0) return empty;
  const bytes = uniqueWorktreeBytes(entries);
  const dirty = entries.filter((entry) => entry.isDirty !== false).length;
  const dirtyNote =
    dirty > 0 ? ` · ${pluralCount(dirty, "tree")} with uncommitted or unread changes` : "";
  return `${pluralCount(entries.length, "worktree")} · ${formatStorageBytes(bytes)}${dirtyNote}`;
}

export function orphanDetail(orphans: ReadonlyArray<StorageOrphanEntry>, bytes: number): string {
  if (orphans.length === 0) {
    return "No unmanaged checkouts under the worktrees folder.";
  }
  return `${pluralCount(orphans.length, "path")} · ${formatStorageBytes(bytes)}`;
}

export function archivedDeleteDetail(inventory: StorageInventory): string {
  const count = inventory.archivedWorktrees.length;
  if (count === 0) {
    return "No archived threads currently keep a worktree on disk.";
  }
  return `${pluralCount(count, "archived thread")} · ${formatStorageBytes(inventory.archivedWorktreeBytes)} in worktrees`;
}

export function isStorageScanInProgress(
  inventory: StorageInventory | null,
  isPending: boolean,
): boolean {
  // The inventory stream is mounted through `followStream`, which stays open
  // after the finite walk ends, so `waiting` remains true once a complete
  // frame has arrived. A leftover `scan.status === "scanning"` snapshot after
  // a dropped stream is not in-flight work either.
  return isPending && inventory?.scan?.status !== "complete";
}

export function scanProgressCaption(inventory: StorageInventory): string | null {
  const scan = inventory.scan;
  if (scan === undefined || scan.status !== "scanning") return null;
  if (scan.totalCount === 0) {
    return "Looking for managed worktrees…";
  }
  return `Found ${formatStorageBytes(inventory.totalBytes)} so far · ${scan.measuredCount} of ${scan.totalCount} paths`;
}

export function summaryCaption(inventory: StorageInventory): string {
  const progress = scanProgressCaption(inventory);
  if (progress !== null) return progress;
  const worktreeCount = inventory.activeWorktrees.length + inventory.archivedWorktrees.length;
  return `${pluralCount(worktreeCount, "worktree")} measured`;
}

export function worktreeRowDescription(entry: StorageWorktreeEntry): string {
  const parts = [entry.projectName];
  if (entry.branch !== null && entry.branch.length > 0) {
    parts.push(entry.branch);
  }
  if (entry.setupStatus === "missing") {
    parts.push("missing on disk");
  } else if (entry.setupStatus === "repair-needed") {
    parts.push("needs repair");
  } else if (entry.isDirty === true) {
    parts.push("uncommitted changes");
  } else if (entry.isDirty === null) {
    parts.push("status unread");
  }
  if (entry.ownerCount > 1) {
    parts.push(
      `shared with ${entry.ownerCount - 1} other ${entry.ownerCount === 2 ? "thread" : "threads"}`,
    );
  }
  return parts.join(" · ");
}

export type StoragePendingAction =
  | { readonly kind: "remove-clean-settled" }
  | { readonly kind: "remove-all-settled" }
  | { readonly kind: "delete-archived" }
  | { readonly kind: "remove-orphans" }
  | { readonly kind: "remove-worktree"; readonly entry: StorageWorktreeEntry }
  | { readonly kind: "delete-thread"; readonly entry: StorageWorktreeEntry }
  | { readonly kind: "remove-orphan"; readonly orphan: StorageOrphanEntry };

export function pendingActionCopy(action: StoragePendingAction): {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
} {
  switch (action.kind) {
    case "remove-clean-settled":
      return {
        title: "Remove clean settled worktrees?",
        message:
          "Only settled or archived worktrees with a clean working tree are removed. Threads stay available on the project checkout.",
        confirmLabel: "Remove",
      };
    case "remove-all-settled":
      return {
        title: "Remove all settled worktrees?",
        message:
          "Every settled or archived worktree that can be removed is deleted, including those with uncommitted or unread changes. Dirty changes cannot be recovered.",
        confirmLabel: "Remove",
      };
    case "delete-archived":
      return {
        title: "Delete archived threads with worktrees?",
        message:
          "Archived threads that keep a managed worktree are permanently deleted, along with those worktrees. This can't be undone.",
        confirmLabel: "Delete",
      };
    case "remove-orphans":
      return {
        title: "Remove orphan checkouts?",
        message:
          "Deletes managed worktree folders that no thread owns. Only paths under this environment's worktrees folder are removed.",
        confirmLabel: "Remove",
      };
    case "remove-worktree":
      return {
        title: `Remove worktree for “${action.entry.threadTitle}”?`,
        message:
          action.entry.isDirty === true
            ? "This worktree has uncommitted changes. Removing it discards those changes. The thread stays available on the project checkout."
            : action.entry.ownerCount > 1
              ? "Other threads still use this checkout, so only this thread is unlinked. The folder stays on disk."
              : "The thread stays available and returns to the project checkout.",
        confirmLabel: "Remove",
      };
    case "delete-thread":
      return {
        title: `Delete “${action.entry.threadTitle}”?`,
        message: `“${action.entry.threadTitle}” and its managed worktree will be permanently deleted.`,
        confirmLabel: "Delete",
      };
    case "remove-orphan":
      return {
        title: `Remove orphan “${action.orphan.displayName}”?`,
        message: `Deletes ${action.orphan.path}. Only managed worktree paths can be removed this way.`,
        confirmLabel: "Remove",
      };
  }
}
