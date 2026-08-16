import {
  ArchiveIcon,
  CheckCircle2Icon,
  FolderOpenIcon,
  HelpCircleIcon,
  HardDriveIcon,
  LoaderIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useMemo, useState } from "react";
import type { EnvironmentId, StorageInventory, StorageWorktreeEntry } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import { formatWorktreePathForDisplay } from "../../worktreeCleanup";
import { useAtomCommand } from "../../state/use-atom-command";
import { primaryServerAvailableEditorsAtom, serverEnvironment } from "../../state/server";
import { shellEnvironment } from "../../state/shell";
import { threadEnvironment } from "../../state/threads";
import { vcsEnvironment } from "../../state/vcs";
import {
  refreshStorageInventory,
  useStorageInventories,
  type EnvironmentStorageStatus,
} from "../../state/storageInventory";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  archivedDeleteDetail,
  cleanSettledWorktrees,
  cleanupDetail,
  diskPathsReleasedByRemoval,
  formatStorageBytes,
  isStorageScanInProgress,
  orphanDetail,
  pendingActionCopy,
  settledWorktrees,
  summaryCaption,
  type StoragePendingAction,
  worktreeRowDescription,
  worktreeShouldForceRemove,
} from "./StorageSettings.logic";

type PendingDialog = {
  readonly environmentId: EnvironmentId;
  readonly inventory: StorageInventory;
  readonly action: StoragePendingAction;
};

function StorageRefreshButton({
  isPending,
  onRefresh,
}: {
  readonly isPending: boolean;
  readonly onRefresh: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Refresh storage"
            disabled={isPending}
            onClick={onRefresh}
          >
            <RefreshCwIcon className={isPending ? "size-3.5 animate-spin" : "size-3.5"} />
          </Button>
        }
      />
      <TooltipPopup side="top">Refresh</TooltipPopup>
    </Tooltip>
  );
}

function StorageUsageBar({ inventory }: { readonly inventory: StorageInventory }) {
  const total = Math.max(inventory.totalBytes, 0);
  const segments = [
    {
      key: "active",
      bytes: inventory.activeWorktreeBytes,
      className: "bg-primary",
      label: "Active worktrees",
    },
    {
      key: "archived",
      bytes: inventory.archivedWorktreeBytes,
      className: "bg-sky-500/80",
      label: "Archived worktrees",
    },
    {
      key: "orphan",
      bytes: inventory.orphanWorktreeBytes,
      className: "bg-amber-500/80",
      label: "Orphan checkouts",
    },
  ].filter((segment) => segment.bytes > 0);

  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/50"
      role="img"
      aria-label={`${formatStorageBytes(total)} across managed worktrees`}
    >
      {total > 0
        ? segments.map((segment) => (
            <div
              key={segment.key}
              className={segment.className}
              style={{ flexGrow: segment.bytes, flexBasis: 0 }}
              title={`${segment.label} · ${formatStorageBytes(segment.bytes)}`}
            />
          ))
        : null}
    </div>
  );
}

function UsageLegendRow({
  colorClass,
  label,
  count,
  bytes,
}: {
  readonly colorClass: string;
  readonly label: string;
  readonly count: number;
  readonly bytes: number;
}) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <span className={`size-2 shrink-0 rounded-full ${colorClass}`} />
      <span className="min-w-0 truncate">{label}</span>
      <span className="tabular-nums">{count}</span>
      <span className="ml-auto tabular-nums">{formatStorageBytes(bytes)}</span>
    </div>
  );
}

function DirtyIcon({ isDirty }: { readonly isDirty: boolean | null }) {
  if (isDirty === false) {
    return <CheckCircle2Icon className="size-3.5 text-muted-foreground" />;
  }
  if (isDirty === true) {
    return <TriangleAlertIcon className="size-3.5 text-amber-500" />;
  }
  return <HelpCircleIcon className="size-3.5 text-amber-500" />;
}

export function StorageSettingsPanel() {
  const { environments, refresh } = useStorageInventories();
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const removeOrphan = useAtomCommand(serverEnvironment.removeOrphan, { reportFailure: false });
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  const [openingFolderFor, setOpeningFolderFor] = useState<EnvironmentId | null>(null);

  const dialogCopy = useMemo(
    () => (pending === null ? null : pendingActionCopy(pending.action)),
    [pending],
  );

  const reportFailure = useCallback(
    (title: string, result: AtomCommandResult<unknown, unknown>) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return false;
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      });
      return true;
    },
    [],
  );

  const unlinkAndMaybeDelete = useCallback(
    async (
      environmentId: EnvironmentId,
      inventory: StorageInventory,
      entries: ReadonlyArray<StorageWorktreeEntry>,
    ) => {
      const threadIds = new Set(entries.map((entry) => entry.threadId));
      const released = diskPathsReleasedByRemoval(inventory, threadIds);
      const removedPaths = new Set<string>();
      for (const entry of entries) {
        const metaResult = await updateMetadata({
          environmentId,
          input: { threadId: entry.threadId, worktreePath: null },
        });
        if (reportFailure("Failed to unlink worktree", metaResult)) {
          continue;
        }
        if (
          released.has(entry.path) &&
          !removedPaths.has(entry.path) &&
          entry.setupStatus !== "missing"
        ) {
          removedPaths.add(entry.path);
          const removeResult = await removeWorktree({
            environmentId,
            input: {
              cwd: entry.projectWorkspaceRoot,
              path: entry.path,
              force: worktreeShouldForceRemove(entry),
            },
          });
          reportFailure("Failed to remove worktree", removeResult);
        }
      }
    },
    [removeWorktree, reportFailure, updateMetadata],
  );

  const performPending = useCallback(async () => {
    if (pending === null) return;
    const { environmentId, inventory, action } = pending;
    setIsOperating(true);
    try {
      switch (action.kind) {
        case "remove-clean-settled":
          await unlinkAndMaybeDelete(environmentId, inventory, [
            ...cleanSettledWorktrees(inventory),
          ]);
          break;
        case "remove-all-settled":
          await unlinkAndMaybeDelete(environmentId, inventory, [...settledWorktrees(inventory)]);
          break;
        case "delete-archived":
          await unlinkAndMaybeDelete(environmentId, inventory, inventory.archivedWorktrees);
          for (const entry of inventory.archivedWorktrees) {
            const result = await deleteThread({
              environmentId,
              input: { threadId: entry.threadId },
            });
            reportFailure("Failed to delete thread", result);
          }
          break;
        case "remove-orphans":
          for (const orphan of inventory.orphanWorktrees) {
            const result = await removeOrphan({
              environmentId,
              input: { path: orphan.path },
            });
            reportFailure("Failed to remove orphan", result);
          }
          break;
        case "remove-worktree":
          await unlinkAndMaybeDelete(environmentId, inventory, [action.entry]);
          break;
        case "delete-thread":
          await unlinkAndMaybeDelete(environmentId, inventory, [action.entry]);
          {
            const result = await deleteThread({
              environmentId,
              input: { threadId: action.entry.threadId },
            });
            reportFailure("Failed to delete thread", result);
          }
          break;
        case "remove-orphan": {
          const result = await removeOrphan({
            environmentId,
            input: { path: action.orphan.path },
          });
          reportFailure("Failed to remove orphan", result);
          break;
        }
      }
      refreshStorageInventory(environmentId);
    } finally {
      setIsOperating(false);
      setPending(null);
    }
  }, [deleteThread, pending, removeOrphan, reportFailure, unlinkAndMaybeDelete]);

  const openManagedFolder = useCallback(
    async (environmentId: EnvironmentId, folderPath: string) => {
      const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
      if (!editor) {
        toastManager.add({
          type: "error",
          title: "Could not open folder",
          description: "No available editors found.",
        });
        return;
      }
      setOpeningFolderFor(environmentId);
      const result = await openInEditor({
        environmentId,
        input: { cwd: folderPath, editor },
      });
      setOpeningFolderFor(null);
      reportFailure("Could not open folder", result);
    },
    [availableEditors, openInEditor, reportFailure],
  );

  return (
    <SettingsPageContainer>
      {environments.length === 0 ? (
        <SettingsSection id={searchableSetting("storage-disk-use").id} title="Disk use">
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                <HardDriveIcon className="size-3.5 text-muted-foreground" />
                Connect an environment to measure storage
              </span>
            }
            description="Managed worktrees are measured on each connected environment. Project checkouts are never counted or removed."
          />
        </SettingsSection>
      ) : (
        environments.map((environment, index) => (
          <EnvironmentStorage
            key={environment.environmentId}
            environment={environment}
            showLabel={environments.length > 1}
            isFirst={index === 0}
            isOperating={isOperating}
            isOpeningFolder={openingFolderFor === environment.environmentId}
            onRefresh={refresh}
            onOpenFolder={openManagedFolder}
            onPending={(action, inventory) =>
              setPending({
                environmentId: environment.environmentId,
                inventory,
                action,
              })
            }
          />
        ))
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !isOperating) setPending(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogCopy?.title ?? "Confirm"}</AlertDialogTitle>
            <AlertDialogDescription>{dialogCopy?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              disabled={isOperating}
              render={<Button variant="outline" disabled={isOperating} />}
            >
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={isOperating || pending === null}
              onClick={() => void performPending()}
            >
              {dialogCopy?.confirmLabel ?? "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsPageContainer>
  );
}

function EnvironmentStorage({
  environment,
  showLabel,
  isFirst,
  isOperating,
  isOpeningFolder,
  onRefresh,
  onOpenFolder,
  onPending,
}: {
  readonly environment: EnvironmentStorageStatus;
  readonly showLabel: boolean;
  readonly isFirst: boolean;
  readonly isOperating: boolean;
  readonly isOpeningFolder: boolean;
  readonly onRefresh: () => void;
  readonly onOpenFolder: (environmentId: EnvironmentId, folderPath: string) => void;
  readonly onPending: (action: StoragePendingAction, inventory: StorageInventory) => void;
}) {
  const inventory = environment.inventory;
  const scanning = isStorageScanInProgress(inventory, environment.isPending);
  const actionsDisabled = isOperating || scanning;
  const cleanSettled = inventory ? cleanSettledWorktrees(inventory) : [];
  const allSettled = inventory ? settledWorktrees(inventory) : [];

  if (environment.unsupported) {
    return (
      <SettingsSection
        id={isFirst ? searchableSetting("storage-disk-use").id : undefined}
        title={showLabel ? environment.label : searchableSetting("storage-disk-use").title}
      >
        <SettingsRow
          title="Storage inventory needs a server update"
          description="This environment's server does not report managed worktrees yet. Update the server, then reopen Storage."
        />
      </SettingsSection>
    );
  }

  if (environment.error !== null && inventory === null) {
    return (
      <SettingsSection
        id={isFirst ? searchableSetting("storage-disk-use").id : undefined}
        title={showLabel ? environment.label : searchableSetting("storage-disk-use").title}
      >
        <SettingsRow title="Could not measure storage" description={environment.error} />
      </SettingsSection>
    );
  }

  if (inventory === null) {
    return (
      <SettingsSection
        id={isFirst ? searchableSetting("storage-disk-use").id : undefined}
        title={showLabel ? environment.label : searchableSetting("storage-disk-use").title}
        headerAction={
          <StorageRefreshButton isPending={environment.isPending} onRefresh={onRefresh} />
        }
      >
        <div className="rounded-xl px-3 py-3 sm:px-4">
          <div className="flex items-baseline gap-3">
            <p className="inline-flex items-center gap-2 font-medium text-foreground">
              <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
              Measuring storage
            </p>
            <p className="text-[13px] text-muted-foreground">
              Byte totals appear here as each managed worktree is counted.
            </p>
          </div>
        </div>
      </SettingsSection>
    );
  }

  return (
    <>
      {showLabel ? (
        <h2 className="px-3 text-sm font-medium text-muted-foreground sm:px-4">
          {environment.label}
        </h2>
      ) : null}

      <SettingsSection
        id={isFirst ? searchableSetting("storage-disk-use").id : undefined}
        title={searchableSetting("storage-disk-use").title}
        headerAction={
          <StorageRefreshButton isPending={environment.isPending} onRefresh={onRefresh} />
        }
      >
        <div className="rounded-xl px-3 py-3 sm:px-4">
          <div className="flex items-baseline gap-3">
            <p className="inline-flex items-center gap-2 font-mono text-lg font-semibold tabular-nums text-foreground">
              {scanning ? (
                <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
              ) : null}
              {formatStorageBytes(inventory.totalBytes)}
            </p>
            <p className="text-[13px] text-muted-foreground">{summaryCaption(inventory)}</p>
          </div>
          <div className="mt-3">
            <StorageUsageBar inventory={inventory} />
          </div>
          <div className="mt-3 space-y-1.5">
            <UsageLegendRow
              colorClass="bg-primary"
              label="Active worktrees"
              count={inventory.activeWorktrees.length}
              bytes={inventory.activeWorktreeBytes}
            />
            <UsageLegendRow
              colorClass="bg-sky-500/80"
              label="Archived worktrees"
              count={inventory.archivedWorktrees.length}
              bytes={inventory.archivedWorktreeBytes}
            />
            <UsageLegendRow
              colorClass="bg-amber-500/80"
              label="Orphan checkouts"
              count={inventory.orphanWorktrees.length}
              bytes={inventory.orphanWorktreeBytes}
            />
          </div>
          <p className="mt-3 max-w-xl text-[13px] leading-[1.45] text-muted-foreground/80">
            Sizes are allocated on-disk bytes for this environment's managed worktrees. Project
            checkouts outside that folder are never counted or removed.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        id={isFirst ? searchableSetting("storage-cleanup").id : undefined}
        title="Cleanup"
      >
        <SettingsRow
          title="Remove clean settled worktrees"
          description={cleanupDetail(
            cleanSettled,
            "No settled worktrees with a clean working tree.",
          )}
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={actionsDisabled || cleanSettled.length === 0}
              onClick={() => onPending({ kind: "remove-clean-settled" }, inventory)}
            >
              Run
            </Button>
          }
        />
        <SettingsRow
          title="Remove all settled worktrees"
          description={cleanupDetail(allSettled, "No settled worktrees can be removed right now.")}
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={actionsDisabled || allSettled.length === 0}
              onClick={() => onPending({ kind: "remove-all-settled" }, inventory)}
            >
              Run
            </Button>
          }
        />
        <SettingsRow
          title="Delete archived threads with worktrees"
          description={archivedDeleteDetail(inventory)}
          control={
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={actionsDisabled || inventory.archivedWorktrees.length === 0}
              onClick={() => onPending({ kind: "delete-archived" }, inventory)}
            >
              Run
            </Button>
          }
        />
        <SettingsRow
          title="Remove orphan checkouts"
          description={orphanDetail(inventory.orphanWorktrees, inventory.orphanWorktreeBytes)}
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={actionsDisabled || inventory.orphanWorktrees.length === 0}
              onClick={() => onPending({ kind: "remove-orphans" }, inventory)}
            >
              Run
            </Button>
          }
        />
        <p className="px-3 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
          Removing a worktree returns its thread to the project checkout. Deleting archived threads
          permanently removes their transcript and any managed worktree.
        </p>
      </SettingsSection>

      <WorktreeListSection
        {...(isFirst ? { id: searchableSetting("storage-active-worktrees").id } : {})}
        title={searchableSetting("storage-active-worktrees").title}
        entries={inventory.activeWorktrees}
        emptyLabel="No active threads own a worktree right now."
        emptyWithoutWorktree={inventory.activeThreadsWithoutWorktree}
        isOperating={actionsDisabled}
        onRemove={(entry) => onPending({ kind: "remove-worktree", entry }, inventory)}
      />

      <WorktreeListSection
        {...(isFirst ? { id: searchableSetting("storage-archived-worktrees").id } : {})}
        title={searchableSetting("storage-archived-worktrees").title}
        entries={inventory.archivedWorktrees}
        emptyLabel="No archived threads currently keep a worktree on disk."
        emptyWithoutWorktree={inventory.archivedThreadsWithoutWorktree}
        isOperating={actionsDisabled}
        deleteLabel
        onRemove={(entry) => onPending({ kind: "delete-thread", entry }, inventory)}
      />

      <SettingsSection
        id={isFirst ? searchableSetting("storage-residual").id : undefined}
        title={searchableSetting("storage-residual").title}
      >
        {inventory.orphanWorktrees.length === 0 ? (
          <SettingsRow title="No orphan checkouts under the managed worktrees folder." />
        ) : (
          inventory.orphanWorktrees.map((orphan) => (
            <SettingsRow
              key={orphan.path}
              title={orphan.displayName}
              description={orphan.path}
              control={
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-[13px] text-muted-foreground">
                    {formatStorageBytes(orphan.diskUsageBytes)}
                  </span>
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={actionsDisabled}
                    onClick={() => onPending({ kind: "remove-orphan", orphan }, inventory)}
                  >
                    Remove
                  </Button>
                </div>
              }
            />
          ))
        )}
        <SettingsRow
          title="Managed worktrees folder"
          description={inventory.managedWorktreesRoot}
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={isOpeningFolder}
              onClick={() =>
                onOpenFolder(environment.environmentId, inventory.managedWorktreesRoot)
              }
            >
              <FolderOpenIcon className="size-3" />
              Open
            </Button>
          }
        />
        <p className="px-3 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
          Orphans are directories under this environment's managed worktrees folder that no thread
          owns — usually left behind by crashes or manual deletes. Paths outside that folder are
          never listed.
        </p>
      </SettingsSection>
    </>
  );
}

function WorktreeListSection({
  id,
  title,
  entries,
  emptyLabel,
  emptyWithoutWorktree,
  isOperating,
  deleteLabel = false,
  onRemove,
}: {
  readonly id?: string;
  readonly title: string;
  readonly entries: ReadonlyArray<StorageWorktreeEntry>;
  readonly emptyLabel: string;
  readonly emptyWithoutWorktree: number;
  readonly isOperating: boolean;
  readonly deleteLabel?: boolean;
  readonly onRemove: (entry: StorageWorktreeEntry) => void;
}) {
  return (
    <SettingsSection {...(id === undefined ? {} : { id })} title={title}>
      {entries.length === 0 ? (
        <SettingsRow
          title={emptyLabel}
          description={
            emptyWithoutWorktree > 0
              ? `${emptyWithoutWorktree} ${title.toLowerCase()} have no worktree on disk.`
              : undefined
          }
        />
      ) : (
        entries.map((item) => (
          <SettingsRow
            key={item.threadId}
            title={
              <span className="inline-flex min-w-0 items-center gap-2">
                {deleteLabel ? (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                ) : (
                  <DirtyIcon isDirty={item.isDirty} />
                )}
                <span className="truncate">{item.threadTitle}</span>
              </span>
            }
            description={
              <>
                {worktreeRowDescription(item)}
                {" · "}
                {formatWorktreePathForDisplay(item.path)}
              </>
            }
            control={
              <div className="flex items-center gap-2">
                <span className="tabular-nums text-[13px] text-muted-foreground">
                  {formatStorageBytes(item.diskUsageBytes)}
                </span>
                {deleteLabel ? (
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={isOperating}
                    onClick={() => onRemove(item)}
                  >
                    Delete
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={isOperating || !item.canRemoveWorktree}
                          onClick={() => onRemove(item)}
                        >
                          Remove
                        </Button>
                      }
                    />
                    <TooltipPopup side="top">
                      {item.canRemoveWorktree
                        ? "Remove this worktree and return the thread to the project checkout"
                        : "Wait for the thread to settle before removing its worktree"}
                    </TooltipPopup>
                  </Tooltip>
                )}
              </div>
            }
          />
        ))
      )}
    </SettingsSection>
  );
}
