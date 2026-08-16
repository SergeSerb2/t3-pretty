import * as Schema from "effect/Schema";

import {
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;

export const StorageWorktreeSetupStatus = Schema.Literals(["ready", "repair-needed", "missing"]);
export type StorageWorktreeSetupStatus = typeof StorageWorktreeSetupStatus.Type;

/**
 * One thread-owned checkout under the environment's managed worktrees folder.
 * Project checkouts outside that folder are never listed.
 */
export const StorageWorktreeEntry = Schema.Struct({
  threadId: ThreadId,
  threadTitle: Schema.String,
  projectId: ProjectId,
  projectName: Schema.String,
  projectWorkspaceRoot: TrimmedNonEmptyStringSchema,
  branch: Schema.NullOr(TrimmedNonEmptyStringSchema),
  path: TrimmedNonEmptyStringSchema,
  isArchived: Schema.Boolean,
  /**
   * `null` means git status could not be read. Callers must treat that as
   * unsafe, never as a clean working tree.
   */
  isDirty: Schema.NullOr(Schema.Boolean),
  diskUsageBytes: NonNegativeInt,
  setupStatus: StorageWorktreeSetupStatus,
  /** Explicitly settled or archived, and not blocked on the user. */
  canRemoveWorktree: Schema.Boolean,
  /** Threads currently pointing at this path, including this one. */
  ownerCount: PositiveInt,
});
export type StorageWorktreeEntry = typeof StorageWorktreeEntry.Type;

/** A directory under the managed worktrees root that no thread owns. */
export const StorageOrphanEntry = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  displayName: TrimmedNonEmptyStringSchema,
  diskUsageBytes: NonNegativeInt,
});
export type StorageOrphanEntry = typeof StorageOrphanEntry.Type;

/** Incremental scan progress. Absent on older servers, which only send a finished inventory. */
export const StorageInventoryScan = Schema.Struct({
  status: Schema.Literals(["scanning", "complete"]),
  measuredCount: NonNegativeInt,
  totalCount: NonNegativeInt,
});
export type StorageInventoryScan = typeof StorageInventoryScan.Type;

/**
 * Disk use attributable to managed worktrees on one environment. Unique paths
 * are counted once even when several threads share a checkout.
 */
export const StorageInventory = Schema.Struct({
  activeWorktrees: Schema.Array(StorageWorktreeEntry),
  archivedWorktrees: Schema.Array(StorageWorktreeEntry),
  activeThreadsWithoutWorktree: NonNegativeInt,
  archivedThreadsWithoutWorktree: NonNegativeInt,
  orphanWorktrees: Schema.Array(StorageOrphanEntry),
  activeWorktreeBytes: NonNegativeInt,
  archivedWorktreeBytes: NonNegativeInt,
  orphanWorktreeBytes: NonNegativeInt,
  totalBytes: NonNegativeInt,
  managedWorktreesRoot: TrimmedNonEmptyStringSchema,
  scan: Schema.optionalKey(StorageInventoryScan),
});
export type StorageInventory = typeof StorageInventory.Type;

export const StorageGetInventoryInput = Schema.Struct({});
export type StorageGetInventoryInput = typeof StorageGetInventoryInput.Type;

export const StorageRemoveOrphanInput = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
});
export type StorageRemoveOrphanInput = typeof StorageRemoveOrphanInput.Type;

export const StorageRemoveOrphanResult = Schema.Struct({
  removed: Schema.Boolean,
});
export type StorageRemoveOrphanResult = typeof StorageRemoveOrphanResult.Type;

export class StorageInventoryError extends Schema.TaggedErrorClass<StorageInventoryError>()(
  "StorageInventoryError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Storage inventory failed in ${this.operation}: ${this.detail}`;
  }
}

export class StoragePathNotManagedError extends Schema.TaggedErrorClass<StoragePathNotManagedError>()(
  "StoragePathNotManagedError",
  {
    path: Schema.String,
    managedWorktreesRoot: Schema.String,
  },
) {
  override get message(): string {
    return `Refusing to remove "${this.path}" because it is outside the managed worktrees folder.`;
  }
}

export const StorageInventoryServiceError = Schema.Union([
  StorageInventoryError,
  StoragePathNotManagedError,
]);
export type StorageInventoryServiceError = typeof StorageInventoryServiceError.Type;
