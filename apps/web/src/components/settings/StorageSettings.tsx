import {
  ArchiveIcon,
  CheckCircle2Icon,
  CloudIcon,
  FolderOpenIcon,
  HelpCircleIcon,
  HardDriveIcon,
  LaptopIcon,
  LoaderIcon,
  MonitorIcon,
  RefreshCwIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import type { ConnectionTarget } from "@t3tools/client-runtime/connection";
import { SURGE_CONNECT_NAME } from "@t3tools/shared/connectBranding";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { useCallback, useMemo, useState } from "react";
import type {
  EnvironmentId,
  StorageCleanupSettings,
  StorageInventory,
  StorageWorktreeEntry,
  WorktreeCleanupRules,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import { resolveAndPersistPreferredEditor } from "../../editorPreferences";
import { cn } from "../../lib/utils";
import { formatWorktreePathForDisplay } from "../../worktreeCleanup";
import { useAtomCommand } from "../../state/use-atom-command";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerAvailableEditorsAtom, serverEnvironment } from "../../state/server";
import { shellEnvironment } from "../../state/shell";
import { threadEnvironment } from "../../state/threads";
import { vcsEnvironment } from "../../state/vcs";
import { useStatusPulse } from "../../hooks/useStatusPulse";
import {
  refreshStorageInventory,
  STORAGE_INVENTORY_MAX_ENVIRONMENTS,
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
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  ConnectionStatusDot,
  connectionPhaseDotClassName,
  connectionPhasePingClassName,
} from "../ConnectionStatusDot";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import type { ScopedSettingsTarget } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useClearScopedSettings,
  useScopedSettings,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import {
  archivedDeleteDetail,
  cleanSettledWorktrees,
  cleanupDetail,
  diskPathsReleasedByRemoval,
  formatStorageBytes,
  isStorageScanInProgress,
  orphanDetail,
  pendingActionCopy,
  resolveSelectedStorageEnvironmentId,
  settledWorktrees,
  sortStorageEnvironments,
  storageDeviceStatusText,
  STORAGE_SETTINGS_ROW_BATCH_SIZE,
  storageSettingsRowWindow,
  storageInventoryCoverageWarning,
  summaryCaption,
  type StoragePendingAction,
  worktreeRowDescription,
  worktreeShouldForceRemove,
} from "./StorageSettings.logic";

function RetentionControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-3">
      {value !== null ? (
        <NumberField
          value={draft}
          min={1}
          max={3650}
          step={1}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            if (next === null) setDraft(value);
            else {
              const days = Math.min(3650, Math.max(1, Math.round(next)));
              setDraft(days);
              onChange(days);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={`Decrease ${label}`} />
            <NumberFieldInput
              aria-label={`${label} in days`}
              size={new Intl.NumberFormat().format(draft ?? value).length}
              className="field-sizing-content w-auto min-w-[1ch] grow-0 text-right in-data-[size=sm]:px-1"
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              days
            </span>
            <NumberFieldIncrement aria-label={`Increase ${label}`} />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">Off</span>
      )}
      <Switch
        aria-label={label}
        checked={value !== null}
        onCheckedChange={(enabled) => onChange(enabled ? 8 : null)}
      />
    </div>
  );
}

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
  useStatusPulse(isPending);
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
            <RefreshCwIcon className={isPending ? "status-pulse size-3.5" : "size-3.5"} />
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
            <Tooltip key={segment.key}>
              <TooltipTrigger
                render={
                  <div
                    className={segment.className}
                    style={{ flexGrow: segment.bytes, flexBasis: 0 }}
                  />
                }
              />
              <TooltipPopup side="top">
                {`${segment.label} · ${formatStorageBytes(segment.bytes)}`}
              </TooltipPopup>
            </Tooltip>
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

function storageEnvironmentIcon(target: ConnectionTarget) {
  if (target._tag === "PrimaryConnectionTarget") return MonitorIcon;
  if (target._tag === "RelayConnectionTarget") return CloudIcon;
  if (target._tag === "SshConnectionTarget") return TerminalIcon;
  if (isDesktopLocalConnectionTarget(target)) return LaptopIcon;
  return CloudIcon;
}

function storageEnvironmentDetail(target: ConnectionTarget): string {
  if (target._tag === "PrimaryConnectionTarget") return "This device";
  if (target._tag === "RelayConnectionTarget") return SURGE_CONNECT_NAME;
  if (target._tag === "SshConnectionTarget") return "SSH";
  if (isDesktopLocalConnectionTarget(target)) return "Local device";
  return "Remote device";
}

function StorageDeviceCard({
  environment,
  selected,
  onSelect,
}: {
  readonly environment: EnvironmentStorageStatus;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const Icon = storageEnvironmentIcon(environment.target);
  const statusText = storageDeviceStatusText(environment);
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors sm:px-4",
        selected ? "bg-primary/8 ring-1 ring-primary/25 dark:bg-primary/12" : "hover:bg-muted/40",
      )}
      onClick={onSelect}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <ConnectionStatusDot
            tooltipText={statusText}
            dotClassName={connectionPhaseDotClassName(environment.connectionPhase)}
            pingClassName={connectionPhasePingClassName(environment.connectionPhase)}
          />
          <span className="truncate text-sm font-medium text-foreground">{environment.label}</span>
        </span>
        <span className="block truncate pl-[18px] text-xs text-muted-foreground">
          {storageEnvironmentDetail(environment.target)} · {statusText}
        </span>
      </span>
    </button>
  );
}

function StorageCleanupPolicySections() {
  const { scope, connectedEnvironments, targets, target } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = {
    ...scopedSettings.storageCleanup,
    ...resolveWorktreeCleanup(scopedSettings, null),
  };
  const projectMode = (entry: ScopedSettingsTarget | null) =>
    entry?.sources.worktreeCleanup === "project"
      ? (entry.settings.worktreeCleanup?.mode ?? "inherit")
      : "inherit";
  const mode = projectMode(target);
  const mixedModes = targets.some((entry) => projectMode(entry) !== mode);
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some(
      (target) =>
        ({ ...target.settings.storageCleanup, ...resolveWorktreeCleanup(target.settings, null) })[
          key
        ] !== settings[key],
    )
      ? "Mixed across selected machines"
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const updateWorktree = (patch: Partial<WorktreeCleanupRules>) =>
    isProjectScope
      ? updateSettings({ worktreeCleanup: { mode: "custom", rules: patch } })
      : update(patch);

  if (
    isProjectScope &&
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.projectWorktreeCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice target="all">
        Update the selected machines to configure project worktree cleanup.
      </SettingsScopeNotice>
    );
  }

  if (
    connectedEnvironments.some(
      (environment) => environment.serverConfig?.environment.capabilities.storageCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice
        target="environment"
        eligibleEnvironmentIds={connectedEnvironments
          .filter(
            (environment) =>
              environment.serverConfig?.environment.capabilities.storageCleanup === true,
          )
          .map((environment) => environment.environmentId)}
      >
        Update the selected environments to use storage cleanup, or choose a machine that supports
        it.
      </SettingsScopeNotice>
    );
  }

  return (
    <>
      <SettingsSection id="storage-worktrees" title="Worktrees">
        {isProjectScope && (
          <SettingsRow
            title="Automatic worktree cleanup"
            description={
              mode === "off"
                ? "Keep this project's worktrees until you delete them manually."
                : mode === "custom"
                  ? "Use these rules for this project."
                  : "Use each machine's worktree cleanup settings."
            }
            serverScoped
            settingKeys={["worktreeCleanup"]}
            mixed={mixedModes}
            control={
              <Select
                value={mixedModes ? null : mode}
                onValueChange={(next) => {
                  if (next === "inherit") clearSettings(["worktreeCleanup"]);
                  else if (next === "off") updateSettings({ worktreeCleanup: { mode: "off" } });
                  else if (next === "custom")
                    updateSettings({ worktreeCleanup: { mode: "custom", rules: {} } });
                }}
              >
                <SelectTrigger size="sm" aria-label="Automatic worktree cleanup">
                  <SelectValue>
                    {mixedModes
                      ? "Mixed"
                      : mode === "inherit"
                        ? "Inherit"
                        : mode === "off"
                          ? "Off"
                          : "Custom"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="inherit">Inherit</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        )}
        {(!isProjectScope || (!mixedModes && mode === "custom")) && (
          <>
            <SettingsRow
              title="Delete worktrees with deleted threads"
              status={ruleStatus("worktreeOnDelete")}
              description="Remove unused worktrees when active or archived threads are deleted. Worktrees with local changes are kept."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete worktrees with deleted threads"
                  checked={settings.worktreeOnDelete}
                  onCheckedChange={(worktreeOnDelete) => updateWorktree({ worktreeOnDelete })}
                />
              }
            />
            <SettingsRow
              title="Delete inactive worktrees"
              status={ruleStatus("worktreeAfterDays")}
              description="Remove worktrees after their threads have been inactive for this many days. Branches and thread history are kept."
              serverScoped={!isProjectScope}
              control={
                <RetentionControl
                  label="Delete inactive worktrees"
                  value={settings.worktreeAfterDays}
                  onChange={(worktreeAfterDays) => updateWorktree({ worktreeAfterDays })}
                />
              }
            />
            <SettingsRow
              title="Delete merged worktrees"
              status={ruleStatus("worktreeOnMerge")}
              description="Remove worktrees whose pull request is merged and whose commits are included in the default branch."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete merged worktrees"
                  checked={settings.worktreeOnMerge}
                  onCheckedChange={(worktreeOnMerge) => updateWorktree({ worktreeOnMerge })}
                />
              }
            />
            <SettingsRow
              title="Delete unchanged worktrees"
              status={ruleStatus("worktreeUnchanged")}
              description="Remove worktrees with no commits beyond the default branch."
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label="Delete unchanged worktrees"
                  checked={settings.worktreeUnchanged}
                  onCheckedChange={(worktreeUnchanged) => updateWorktree({ worktreeUnchanged })}
                />
              }
            />
          </>
        )}
      </SettingsSection>

      {!isProjectScope && (
        <SettingsSection id="storage-artifacts" title="Artifacts and logs">
          <SettingsRow
            title="Delete old browser artifacts"
            status={ruleStatus("browserArtifactsAfterDays")}
            description="Delete saved browser captures after this many days. Older capture links will no longer open."
            serverScoped
            control={
              <RetentionControl
                label="Delete old browser artifacts"
                value={settings.browserArtifactsAfterDays}
                onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
              />
            }
          />
          <SettingsRow
            title="Delete old rotated logs"
            status={ruleStatus("logsAfterDays")}
            description="Delete inactive rotated log files after this many days. Current logs are kept."
            serverScoped
            control={
              <RetentionControl
                label="Delete old rotated logs"
                value={settings.logsAfterDays}
                onChange={(logsAfterDays) => update({ logsAfterDays })}
              />
            }
          />
        </SettingsSection>
      )}
    </>
  );
}

function StorageInventorySettings() {
  const { environments, omittedEnvironmentCount } = useStorageInventories();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const sortedEnvironments = useMemo(
    () => sortStorageEnvironments(environments, primaryEnvironmentId),
    [environments, primaryEnvironmentId],
  );
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const removeOrphan = useAtomCommand(serverEnvironment.removeOrphan, { reportFailure: false });
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  const [openingFolders, setOpeningFolders] = useState<ReadonlySet<EnvironmentId>>(() => new Set());
  // Raw user intent; the effective selection is re-derived every render so a
  // device that drops out of the catalog falls back without erasing the pick —
  // if it reappears (e.g. after a reconnect) the selection is restored.
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    primaryEnvironmentId,
  );
  const effectiveEnvironmentId = resolveSelectedStorageEnvironmentId(
    sortedEnvironments,
    selectedEnvironmentId,
    primaryEnvironmentId,
  );
  const selectedEnvironment =
    sortedEnvironments.find(
      (environment) => environment.environmentId === effectiveEnvironmentId,
    ) ?? null;

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
      setOpeningFolders((current) => new Set(current).add(environmentId));
      try {
        const result = await openInEditor({
          environmentId,
          input: { cwd: folderPath, editor },
        });
        reportFailure("Could not open folder", result);
      } finally {
        setOpeningFolders((current) => {
          if (!current.has(environmentId)) return current;
          const next = new Set(current);
          next.delete(environmentId);
          return next;
        });
      }
    },
    [availableEditors, openInEditor, reportFailure],
  );

  return (
    <>
      {sortedEnvironments.length === 0 ? (
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
        <>
          {sortedEnvironments.length > 1 ? (
            <SettingsSection title="Devices">
              <div className="grid gap-1 sm:grid-cols-2">
                {sortedEnvironments.map((environment) => (
                  <StorageDeviceCard
                    key={environment.environmentId}
                    environment={environment}
                    selected={environment.environmentId === effectiveEnvironmentId}
                    onSelect={() => setSelectedEnvironmentId(environment.environmentId)}
                  />
                ))}
              </div>
            </SettingsSection>
          ) : null}
          {selectedEnvironment !== null ? (
            <EnvironmentStorage
              key={selectedEnvironment.environmentId}
              environment={selectedEnvironment}
              isOperating={isOperating}
              isOpeningFolder={openingFolders.has(selectedEnvironment.environmentId)}
              onOpenFolder={openManagedFolder}
              onPending={(action, inventory) =>
                setPending({
                  environmentId: selectedEnvironment.environmentId,
                  inventory,
                  action,
                })
              }
            />
          ) : null}
        </>
      )}

      {omittedEnvironmentCount > 0 ? (
        <SettingsSection title="Additional environments">
          <SettingsRow
            title={`${omittedEnvironmentCount} additional ${
              omittedEnvironmentCount === 1 ? "environment was" : "environments were"
            } not measured`}
            description={`Storage inventory is limited to the first ${STORAGE_INVENTORY_MAX_ENVIRONMENTS} connected environments at once so opening Settings cannot start an unbounded fleet of filesystem scans.`}
          />
        </SettingsSection>
      ) : null}

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
    </>
  );
}

export function StorageSettingsPanel() {
  return (
    <SettingsPageContainer>
      <StorageCleanupPolicySections />
      <StorageInventorySettings />
    </SettingsPageContainer>
  );
}

function EnvironmentStorage({
  environment,
  isOperating,
  isOpeningFolder,
  onOpenFolder,
  onPending,
}: {
  readonly environment: EnvironmentStorageStatus;
  readonly isOperating: boolean;
  readonly isOpeningFolder: boolean;
  readonly onOpenFolder: (environmentId: EnvironmentId, folderPath: string) => void;
  readonly onPending: (action: StoragePendingAction, inventory: StorageInventory) => void;
}) {
  const inventory = environment.inventory;
  const scanning = isStorageScanInProgress(inventory, environment.isPending);
  const actionsDisabled = isOperating || scanning;
  const cleanSettled = inventory ? cleanSettledWorktrees(inventory) : [];
  const allSettled = inventory ? settledWorktrees(inventory) : [];
  const onRefresh = useCallback(
    () => refreshStorageInventory(environment.environmentId),
    [environment.environmentId],
  );
  const coverageWarning = inventory ? storageInventoryCoverageWarning(inventory) : null;
  const bulkActionsDisabled = actionsDisabled || coverageWarning !== null;
  useStatusPulse(scanning);

  if (environment.unsupported) {
    return (
      <SettingsSection
        id={searchableSetting("storage-disk-use").id}
        title={searchableSetting("storage-disk-use").title}
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
        id={searchableSetting("storage-disk-use").id}
        title={searchableSetting("storage-disk-use").title}
      >
        <SettingsRow title="Could not measure storage" description={environment.error} />
      </SettingsSection>
    );
  }

  if (inventory === null) {
    return (
      <SettingsSection
        id={searchableSetting("storage-disk-use").id}
        title={searchableSetting("storage-disk-use").title}
        headerAction={
          <StorageRefreshButton isPending={environment.isPending} onRefresh={onRefresh} />
        }
      >
        <div className="rounded-xl px-3 py-3 sm:px-4">
          <div className="flex items-baseline gap-3">
            <p className="inline-flex items-center gap-2 font-medium text-foreground">
              <LoaderIcon className="status-pulse size-3.5 text-muted-foreground" />
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
      <SettingsSection
        id={searchableSetting("storage-disk-use").id}
        title={searchableSetting("storage-disk-use").title}
        headerAction={<StorageRefreshButton isPending={scanning} onRefresh={onRefresh} />}
      >
        <div className="rounded-xl px-3 py-3 sm:px-4">
          <div className="flex items-baseline gap-3">
            <p className="inline-flex items-center gap-2 font-mono text-lg font-semibold tabular-nums text-foreground">
              {scanning ? (
                <LoaderIcon className="status-pulse size-3.5 text-muted-foreground" />
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
          {coverageWarning === null ? null : (
            <p className="mt-2 max-w-xl text-[13px] leading-[1.45] text-amber-700 dark:text-amber-300">
              {coverageWarning}
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection id={searchableSetting("storage-cleanup").id} title="Cleanup">
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
              disabled={bulkActionsDisabled || cleanSettled.length === 0}
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
              disabled={bulkActionsDisabled || allSettled.length === 0}
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
              disabled={bulkActionsDisabled || inventory.archivedWorktrees.length === 0}
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
              disabled={bulkActionsDisabled || inventory.orphanWorktrees.length === 0}
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
        id={searchableSetting("storage-active-worktrees").id}
        title={searchableSetting("storage-active-worktrees").title}
        entries={inventory.activeWorktrees}
        emptyLabel="No active threads own a worktree right now."
        emptyWithoutWorktree={inventory.activeThreadsWithoutWorktree}
        isOperating={actionsDisabled}
        onRemove={(entry) => onPending({ kind: "remove-worktree", entry }, inventory)}
      />

      <WorktreeListSection
        id={searchableSetting("storage-archived-worktrees").id}
        title={searchableSetting("storage-archived-worktrees").title}
        entries={inventory.archivedWorktrees}
        emptyLabel="No archived threads currently keep a worktree on disk."
        emptyWithoutWorktree={inventory.archivedThreadsWithoutWorktree}
        isOperating={actionsDisabled}
        deleteLabel
        onRemove={(entry) => onPending({ kind: "delete-thread", entry }, inventory)}
      />

      <SettingsSection
        id={searchableSetting("storage-residual").id}
        title={searchableSetting("storage-residual").title}
      >
        {inventory.orphanWorktrees.length === 0 ? (
          <SettingsRow title="No orphan checkouts under the managed worktrees folder." />
        ) : (
          <OrphanWorktreeRows
            actionsDisabled={actionsDisabled}
            inventory={inventory}
            onPending={onPending}
          />
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
  const [requestedVisibleCount, setRequestedVisibleCount] = useState(
    STORAGE_SETTINGS_ROW_BATCH_SIZE,
  );
  const rowWindow = storageSettingsRowWindow(entries.length, requestedVisibleCount);
  const visibleEntries = entries.slice(0, rowWindow.visibleCount);

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
        <>
          {visibleEntries.map((item) => (
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
          ))}
          <StorageRowsRemaining
            noun="worktrees"
            remainingCount={rowWindow.remainingCount}
            onShowMore={() =>
              setRequestedVisibleCount((current) => current + STORAGE_SETTINGS_ROW_BATCH_SIZE)
            }
          />
        </>
      )}
    </SettingsSection>
  );
}

function OrphanWorktreeRows({
  actionsDisabled,
  inventory,
  onPending,
}: {
  readonly actionsDisabled: boolean;
  readonly inventory: StorageInventory;
  readonly onPending: (action: StoragePendingAction, inventory: StorageInventory) => void;
}) {
  const [requestedVisibleCount, setRequestedVisibleCount] = useState(
    STORAGE_SETTINGS_ROW_BATCH_SIZE,
  );
  const rowWindow = storageSettingsRowWindow(
    inventory.orphanWorktrees.length,
    requestedVisibleCount,
  );

  return (
    <>
      {inventory.orphanWorktrees.slice(0, rowWindow.visibleCount).map((orphan) => (
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
      ))}
      <StorageRowsRemaining
        noun="orphan checkouts"
        remainingCount={rowWindow.remainingCount}
        onShowMore={() =>
          setRequestedVisibleCount((current) => current + STORAGE_SETTINGS_ROW_BATCH_SIZE)
        }
      />
    </>
  );
}

function StorageRowsRemaining({
  noun,
  remainingCount,
  onShowMore,
}: {
  readonly noun: string;
  readonly remainingCount: number;
  readonly onShowMore: () => void;
}) {
  if (remainingCount === 0) return null;
  const nextBatchCount = Math.min(remainingCount, STORAGE_SETTINGS_ROW_BATCH_SIZE);
  return (
    <SettingsRow
      title={`${remainingCount.toLocaleString()} more ${noun}`}
      description="Rows are shown in batches so a large inventory keeps Settings responsive."
      control={
        <Button size="xs" variant="outline" onClick={onShowMore}>
          Show {nextBatchCount.toLocaleString()} more
        </Button>
      }
    />
  );
}
