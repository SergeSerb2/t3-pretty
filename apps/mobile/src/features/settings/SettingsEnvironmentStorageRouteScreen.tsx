import type { EnvironmentId, StorageInventory, StorageWorktreeEntry } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import {
  refreshStorageInventory,
  useStorageInventories,
  type EnvironmentStorageStatus,
} from "../../state/storageInventory";
import { threadEnvironment } from "../../state/threads";
import { vcsEnvironment } from "../../state/vcs";
import { SettingsSection } from "./components/SettingsSection";
import {
  cleanSettledWorktrees,
  diskPathsReleasedByRemoval,
  formatStorageBytes,
  isStorageScanInProgress,
  pendingActionCopy,
  scanProgressCaption,
  settledWorktrees,
  type StoragePendingAction,
  worktreeShouldForceRemove,
} from "./environmentStorage.logic";

export function SettingsEnvironmentStorageRouteScreen() {
  const insets = useSafeAreaInsets();
  const { environments, refresh } = useStorageInventories();
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const removeOrphan = useAtomCommand(serverEnvironment.removeOrphan, { reportFailure: false });
  const [isOperating, setIsOperating] = useState(false);

  const reportFailure = useCallback(
    (title: string, result: AtomCommandResult<unknown, unknown>) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return false;
      const error = squashAtomCommandFailure(result);
      Alert.alert(title, error instanceof Error ? error.message : "An error occurred.");
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

  const perform = useCallback(
    async (
      environmentId: EnvironmentId,
      inventory: StorageInventory,
      action: StoragePendingAction,
    ) => {
      const copy = pendingActionCopy(action);
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(copy.title, copy.message, [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: copy.confirmLabel, style: "destructive", onPress: () => resolve(true) },
        ]);
      });
      if (!confirmed) return;
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
      }
    },
    [deleteThread, removeOrphan, reportFailure, unlinkAndMaybeDelete],
  );

  const refreshing = environments.some(
    (environment) => environment.isPending && environment.inventory !== null,
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentInset={{ bottom: Math.max(insets.bottom, 18) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4 pb-[18px]"
      >
        {environments.length === 0 ? (
          <SettingsSection title="Disk use">
            <View className="px-4 py-6">
              <Text className="text-base text-foreground">
                Connect an environment to measure storage
              </Text>
              <Text className="mt-1 text-sm text-foreground-muted">
                Managed worktrees are measured on each connected environment. Project checkouts are
                never counted or removed.
              </Text>
            </View>
          </SettingsSection>
        ) : (
          environments.map((environment) => (
            <EnvironmentStorageCard
              key={environment.environmentId}
              environment={environment}
              showLabel={environments.length > 1}
              disabled={isOperating}
              onAction={perform}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function EnvironmentStorageCard(props: {
  readonly environment: EnvironmentStorageStatus;
  readonly showLabel: boolean;
  readonly disabled: boolean;
  readonly onAction: (
    environmentId: EnvironmentId,
    inventory: StorageInventory,
    action: StoragePendingAction,
  ) => void;
}) {
  const { environment, showLabel, disabled, onAction } = props;
  const inventory = environment.inventory;
  const scanning = isStorageScanInProgress(inventory, environment.isPending);
  const actionsDisabled = disabled || scanning;
  const progressCaption = inventory === null ? null : scanProgressCaption(inventory);

  if (environment.unsupported) {
    return (
      <SettingsSection title={showLabel ? environment.label : "Disk use"}>
        <View className="px-4 py-5">
          <Text className="text-base text-foreground">Storage inventory needs a server update</Text>
          <Text className="mt-1 text-sm text-foreground-muted">
            This environment's server does not report managed worktrees yet. Update the server, then
            reopen Environment Storage.
          </Text>
        </View>
      </SettingsSection>
    );
  }

  if (environment.error !== null && inventory === null) {
    return (
      <SettingsSection title={showLabel ? environment.label : "Disk use"}>
        <View className="px-4 py-5">
          <Text className="text-base text-foreground">Could not measure storage</Text>
          <Text className="mt-1 text-sm text-foreground-muted">{environment.error}</Text>
        </View>
      </SettingsSection>
    );
  }

  if (inventory === null) {
    return (
      <SettingsSection title={showLabel ? environment.label : "Disk use"}>
        <View className="gap-2 px-4 py-5">
          <View className="flex-row items-center gap-2">
            <ActivityIndicator />
            <Text className="text-base text-foreground">Measuring storage</Text>
          </View>
          <Text className="text-sm text-foreground-muted">
            Byte totals appear here as each managed worktree is counted.
          </Text>
        </View>
      </SettingsSection>
    );
  }

  const cleanSettled = cleanSettledWorktrees(inventory);
  const allSettled = settledWorktrees(inventory);

  return (
    <View className="gap-6">
      {showLabel ? (
        <Text className="px-2 text-sm font-t3-medium text-foreground-muted">
          {environment.label}
        </Text>
      ) : null}

      <SettingsSection title="Disk use">
        <View className="gap-3 p-4">
          <View className="flex-row items-center gap-2">
            {scanning ? <ActivityIndicator /> : null}
            <Text className="text-2xl tabular-nums text-foreground">
              {formatStorageBytes(inventory.totalBytes)}
            </Text>
          </View>
          {progressCaption !== null ? (
            <Text className="text-sm text-foreground-muted">{progressCaption}</Text>
          ) : null}
          <StorageUsageBar inventory={inventory} />
          <LegendRow
            colorClass="bg-primary"
            label="Active worktrees"
            count={inventory.activeWorktrees.length}
            bytes={inventory.activeWorktreeBytes}
          />
          <LegendRow
            colorClass="bg-sky-500"
            label="Archived worktrees"
            count={inventory.archivedWorktrees.length}
            bytes={inventory.archivedWorktreeBytes}
          />
          <LegendRow
            colorClass="bg-amber-500"
            label="Orphan checkouts"
            count={inventory.orphanWorktrees.length}
            bytes={inventory.orphanWorktreeBytes}
          />
          <Text className="text-sm leading-normal text-foreground-muted">
            Sizes are allocated on-disk bytes for this environment's managed worktrees. Project
            checkouts outside that folder are never counted or removed.
          </Text>
        </View>
      </SettingsSection>

      <SettingsSection title="Cleanup">
        <ActionRow
          title="Remove clean settled worktrees"
          disabled={actionsDisabled || cleanSettled.length === 0}
          onPress={() =>
            onAction(environment.environmentId, inventory, { kind: "remove-clean-settled" })
          }
        />
        <ActionRow
          title="Remove all settled worktrees"
          disabled={actionsDisabled || allSettled.length === 0}
          onPress={() =>
            onAction(environment.environmentId, inventory, { kind: "remove-all-settled" })
          }
        />
        <ActionRow
          title="Delete archived threads with worktrees"
          destructive
          disabled={actionsDisabled || inventory.archivedWorktrees.length === 0}
          onPress={() =>
            onAction(environment.environmentId, inventory, { kind: "delete-archived" })
          }
        />
        <ActionRow
          title="Remove orphan checkouts"
          disabled={actionsDisabled || inventory.orphanWorktrees.length === 0}
          onPress={() => onAction(environment.environmentId, inventory, { kind: "remove-orphans" })}
        />
      </SettingsSection>

      <SettingsSection title="Active worktrees">
        {inventory.activeWorktrees.length === 0 ? (
          <EmptyRow text="No active threads own a worktree right now." />
        ) : (
          inventory.activeWorktrees.map((entry, index) => (
            <WorktreeRow
              key={entry.threadId}
              entry={entry}
              first={index === 0}
              disabled={actionsDisabled || !entry.canRemoveWorktree}
              actionLabel="Remove"
              onPress={() =>
                onAction(environment.environmentId, inventory, { kind: "remove-worktree", entry })
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title="Archived worktrees">
        {inventory.archivedWorktrees.length === 0 ? (
          <EmptyRow text="No archived threads currently keep a worktree on disk." />
        ) : (
          inventory.archivedWorktrees.map((entry, index) => (
            <WorktreeRow
              key={entry.threadId}
              entry={entry}
              first={index === 0}
              disabled={actionsDisabled}
              actionLabel="Delete"
              destructive
              onPress={() =>
                onAction(environment.environmentId, inventory, { kind: "delete-thread", entry })
              }
            />
          ))
        )}
      </SettingsSection>

      <View className="gap-3">
        <SettingsSection title="Residual managed files">
          {inventory.orphanWorktrees.length === 0 ? (
            <EmptyRow text="No orphan checkouts under the managed worktrees folder." />
          ) : (
            inventory.orphanWorktrees.map((orphan, index) => (
              <View
                key={orphan.path}
                className={
                  index === 0
                    ? "flex-row items-center gap-3 p-4"
                    : "border-t border-border flex-row items-center gap-3 p-4"
                }
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-base text-foreground" numberOfLines={1}>
                    {orphan.displayName}
                  </Text>
                  <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                    {formatStorageBytes(orphan.diskUsageBytes)}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={actionsDisabled}
                  onPress={() =>
                    onAction(environment.environmentId, inventory, {
                      kind: "remove-orphan",
                      orphan,
                    })
                  }
                  className="px-3 py-2 disabled:opacity-40"
                >
                  <Text className="font-t3-medium text-danger-foreground">Remove</Text>
                </Pressable>
              </View>
            ))
          )}
        </SettingsSection>
        <Text className="px-2 text-sm leading-normal text-foreground-muted">
          Orphans are directories under this environment's managed worktrees folder that no thread
          owns. Paths outside that folder are never listed. This is not the same as Client Storage,
          which only clears this device's offline cache.
        </Text>
      </View>
    </View>
  );
}

function StorageUsageBar({ inventory }: { readonly inventory: StorageInventory }) {
  const segments = [
    { key: "active", bytes: inventory.activeWorktreeBytes, className: "bg-primary" },
    { key: "archived", bytes: inventory.archivedWorktreeBytes, className: "bg-sky-500" },
    { key: "orphan", bytes: inventory.orphanWorktreeBytes, className: "bg-amber-500" },
  ].filter((segment) => segment.bytes > 0);
  return (
    <View className="h-2.5 w-full flex-row overflow-hidden rounded-full bg-border">
      {inventory.totalBytes > 0
        ? segments.map((segment) => (
            <View
              key={segment.key}
              className={segment.className}
              style={{ flexGrow: segment.bytes, flexBasis: 0 }}
            />
          ))
        : null}
    </View>
  );
}

function LegendRow(props: {
  readonly colorClass: string;
  readonly label: string;
  readonly count: number;
  readonly bytes: number;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <View className={`size-2 rounded-full ${props.colorClass}`} />
      <Text className="flex-1 text-sm text-foreground-muted">{props.label}</Text>
      <Text className="text-sm tabular-nums text-foreground-muted">{props.count}</Text>
      <Text className="text-sm tabular-nums text-foreground-muted">
        {formatStorageBytes(props.bytes)}
      </Text>
    </View>
  );
}

function ActionRow(props: {
  readonly title: string;
  readonly disabled: boolean;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      className="flex-row items-center p-4 disabled:opacity-40"
    >
      <Text
        className={
          props.destructive
            ? "flex-1 text-lg text-danger-foreground"
            : "flex-1 text-lg text-foreground"
        }
      >
        {props.title}
      </Text>
      <Text className="text-base text-foreground-muted">Run</Text>
    </Pressable>
  );
}

function WorktreeRow(props: {
  readonly entry: StorageWorktreeEntry;
  readonly first: boolean;
  readonly disabled: boolean;
  readonly actionLabel: string;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <View
      className={
        props.first
          ? "flex-row items-center gap-3 p-4"
          : "border-t border-border flex-row items-center gap-3 p-4"
      }
    >
      <View className="min-w-0 flex-1">
        <Text className="text-base text-foreground" numberOfLines={1}>
          {props.entry.threadTitle}
        </Text>
        <Text className="text-sm tabular-nums text-foreground-muted">
          {formatStorageBytes(props.entry.diskUsageBytes)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={props.disabled}
        onPress={props.onPress}
        className="px-3 py-2 disabled:opacity-40"
      >
        <Text
          className={
            props.destructive
              ? "font-t3-medium text-danger-foreground"
              : "font-t3-medium text-foreground"
          }
        >
          {props.actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

function EmptyRow({ text }: { readonly text: string }) {
  return (
    <View className="px-4 py-5">
      <Text className="text-base text-foreground-muted">{text}</Text>
    </View>
  );
}
