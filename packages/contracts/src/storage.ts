import * as Schema from "effect/Schema";

import {
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  THREAD_TURN_START_BRANCH_MAX_LENGTH,
  THREAD_TURN_START_PATH_MAX_LENGTH,
  THREAD_TURN_START_TITLE_MAX_LENGTH,
} from "./orchestration.ts";

export const STORAGE_INVENTORY_MAX_ENTRIES = 4_096;
export const STORAGE_INVENTORY_MAX_STRING_CHARS = 16 * 1024 * 1024;
export const STORAGE_DISPLAY_NAME_MAX_LENGTH = 512;
export const STORAGE_ERROR_OPERATION_MAX_LENGTH = 128;
export const STORAGE_ERROR_DETAIL_MAX_LENGTH = 4_096;

const StoragePath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(THREAD_TURN_START_PATH_MAX_LENGTH),
);
const StorageTitle = Schema.String.check(Schema.isMaxLength(THREAD_TURN_START_TITLE_MAX_LENGTH));
const StorageBranch = TrimmedNonEmptyString.check(
  Schema.isMaxLength(THREAD_TURN_START_BRANCH_MAX_LENGTH),
);
const StorageDisplayName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(STORAGE_DISPLAY_NAME_MAX_LENGTH),
);

export const StorageWorktreeSetupStatus = Schema.Literals(["ready", "repair-needed", "missing"]);
export type StorageWorktreeSetupStatus = typeof StorageWorktreeSetupStatus.Type;

/**
 * One thread-owned checkout under the environment's managed worktrees folder.
 * Project checkouts outside that folder are never listed.
 */
export const StorageWorktreeEntry = Schema.Struct({
  threadId: ThreadId,
  threadTitle: StorageTitle,
  projectId: ProjectId,
  projectName: StorageTitle,
  projectWorkspaceRoot: StoragePath,
  branch: Schema.NullOr(StorageBranch),
  path: StoragePath,
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
  path: StoragePath,
  displayName: StorageDisplayName,
  diskUsageBytes: NonNegativeInt,
});
export type StorageOrphanEntry = typeof StorageOrphanEntry.Type;

/** Incremental scan progress. Absent on older servers, which only send a finished inventory. */
const StorageInventoryScanFields = Schema.Struct({
  status: Schema.Literals(["scanning", "complete"]),
  measuredCount: NonNegativeInt,
  totalCount: NonNegativeInt,
  /** Discovery stopped at a server resource or wire-entry ceiling. */
  truncated: Schema.optionalKey(Schema.Boolean),
  /** Directories that disappeared or could not be read during discovery. */
  unreadableDirectories: Schema.optionalKey(NonNegativeInt),
});
export const StorageInventoryScan = StorageInventoryScanFields.check(
  Schema.makeFilter((scan) =>
    scan.measuredCount <= scan.totalCount
      ? true
      : "storage inventory measuredCount must not exceed totalCount",
  ),
);
export type StorageInventoryScan = typeof StorageInventoryScan.Type;

/**
 * Disk use attributable to managed worktrees on one environment. Unique paths
 * are counted once even when several threads share a checkout.
 */
export const StorageInventory = Schema.Struct({
  activeWorktrees: Schema.Array(StorageWorktreeEntry).check(
    Schema.isMaxLength(STORAGE_INVENTORY_MAX_ENTRIES),
  ),
  archivedWorktrees: Schema.Array(StorageWorktreeEntry).check(
    Schema.isMaxLength(STORAGE_INVENTORY_MAX_ENTRIES),
  ),
  activeThreadsWithoutWorktree: NonNegativeInt,
  archivedThreadsWithoutWorktree: NonNegativeInt,
  orphanWorktrees: Schema.Array(StorageOrphanEntry).check(
    Schema.isMaxLength(STORAGE_INVENTORY_MAX_ENTRIES),
  ),
  activeWorktreeBytes: NonNegativeInt,
  archivedWorktreeBytes: NonNegativeInt,
  orphanWorktreeBytes: NonNegativeInt,
  totalBytes: NonNegativeInt,
  managedWorktreesRoot: StoragePath,
  scan: Schema.optionalKey(StorageInventoryScan),
}).check(
  Schema.makeFilter((inventory) => {
    const entryCount =
      inventory.activeWorktrees.length +
      inventory.archivedWorktrees.length +
      inventory.orphanWorktrees.length;
    if (entryCount > STORAGE_INVENTORY_MAX_ENTRIES) {
      return `storage inventory must contain at most ${STORAGE_INVENTORY_MAX_ENTRIES} entries`;
    }
    let totalCharacters = inventory.managedWorktreesRoot.length;
    for (const entries of [inventory.activeWorktrees, inventory.archivedWorktrees]) {
      for (const entry of entries) {
        totalCharacters +=
          entry.threadTitle.length +
          entry.projectName.length +
          entry.projectWorkspaceRoot.length +
          entry.path.length +
          (entry.branch?.length ?? 0);
        if (totalCharacters > STORAGE_INVENTORY_MAX_STRING_CHARS) {
          return `storage inventory strings must total at most ${STORAGE_INVENTORY_MAX_STRING_CHARS} characters`;
        }
      }
    }
    for (const entry of inventory.orphanWorktrees) {
      totalCharacters += entry.path.length + entry.displayName.length;
      if (totalCharacters > STORAGE_INVENTORY_MAX_STRING_CHARS) {
        return `storage inventory strings must total at most ${STORAGE_INVENTORY_MAX_STRING_CHARS} characters`;
      }
    }
    return true;
  }),
);
export type StorageInventory = typeof StorageInventory.Type;

export const StorageGetInventoryInput = Schema.Struct({});
export type StorageGetInventoryInput = typeof StorageGetInventoryInput.Type;

export const StorageRemoveOrphanInput = Schema.Struct({
  path: StoragePath,
});
export type StorageRemoveOrphanInput = typeof StorageRemoveOrphanInput.Type;

export const StorageRemoveOrphanResult = Schema.Struct({
  removed: Schema.Boolean,
});
export type StorageRemoveOrphanResult = typeof StorageRemoveOrphanResult.Type;

export class StorageInventoryError extends Schema.TaggedErrorClass<StorageInventoryError>()(
  "StorageInventoryError",
  {
    operation: Schema.String.check(Schema.isMaxLength(STORAGE_ERROR_OPERATION_MAX_LENGTH)),
    detail: Schema.String.check(Schema.isMaxLength(STORAGE_ERROR_DETAIL_MAX_LENGTH)),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly operation: string;
    readonly detail: string;
    readonly cause?: unknown;
  }) {
    super({
      operation: props.operation.slice(0, STORAGE_ERROR_OPERATION_MAX_LENGTH),
      detail: props.detail.slice(0, STORAGE_ERROR_DETAIL_MAX_LENGTH),
      ...(props.cause === undefined ? {} : { cause: props.cause }),
    } as any);
  }

  override get message(): string {
    return `Storage inventory failed in ${this.operation}: ${this.detail}`;
  }
}

export class StoragePathNotManagedError extends Schema.TaggedErrorClass<StoragePathNotManagedError>()(
  "StoragePathNotManagedError",
  {
    path: Schema.String.check(Schema.isMaxLength(THREAD_TURN_START_PATH_MAX_LENGTH)),
    managedWorktreesRoot: Schema.String.check(
      Schema.isMaxLength(THREAD_TURN_START_PATH_MAX_LENGTH),
    ),
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
