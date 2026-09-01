import type { ContextMenuItem } from "@t3tools/contracts";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";

/**
 * Ids for the per-thread action menu. Snooze presets are dispatched as
 * `snooze:<presetId>` so the union stays closed while the preset list
 * remains data-driven.
 */
export type ThreadActionMenuId =
  | "new-thread-on-branch"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "transfer"
  | "copy"
  | "copy-conversation"
  | "copy-path"
  | "copy-branch"
  | "copy-thread-id"
  | "archive"
  | "delete"
  | "sep-after-lifecycle"
  | "sep-after-edit"
  | "sep-before-danger";

export interface ThreadActionMenuState {
  readonly branch: string | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects a thread with an active turn, so disable it here rather than let the action fail. */
  readonly isRunning: boolean;
  /**
   * Sidebar rows already expose settle/snooze on hover, so those items are
   * omitted there. The chat header has no hover row, so it keeps them.
   */
  readonly surface: "sidebar" | "header";
  readonly supports: {
    readonly settlement: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
    readonly projectTransfer: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
}

function separator(id: ThreadActionMenuId): ContextMenuItem<ThreadActionMenuId> {
  return { id, label: "", separator: true };
}

function joinGroups(
  groups: ReadonlyArray<ReadonlyArray<ContextMenuItem<ThreadActionMenuId>>>,
): ContextMenuItem<ThreadActionMenuId>[] {
  const items: ContextMenuItem<ThreadActionMenuId>[] = [];
  const separatorIds = ["sep-after-lifecycle", "sep-after-edit", "sep-before-danger"] as const;
  let separatorIndex = 0;
  for (const group of groups) {
    if (group.length === 0) continue;
    if (items.length > 0) {
      const separatorId = separatorIds[Math.min(separatorIndex, separatorIds.length - 1)]!;
      separatorIndex += 1;
      items.push(separator(separatorId));
    }
    items.push(...group);
  }
  return items;
}

/**
 * Single source for the per-thread action menu: the sidebar row's right-click
 * menu and the chat header menu share grouping and copy, but the header keeps
 * settle/snooze because it has no hover-row affordances.
 */
export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const lifecycle: ContextMenuItem<ThreadActionMenuId>[] = [
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: "New thread on this branch",
            icon: "git-branch",
          },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: "Unpin thread", icon: "pin-off" }
            : { id: "pin" as const, label: "Pin thread", icon: "pin" },
        ]
      : []),
  ];

  // Header-only: the sidebar row already has Settle and Snooze on hover.
  if (state.surface === "header") {
    if (state.supports.settlement) {
      lifecycle.push(
        state.isSettled
          ? { id: "unsettle", label: "Un-settle thread", icon: "undo" }
          : { id: "settle", label: "Settle thread", icon: "check" },
      );
    }
    if (state.supports.snooze) {
      lifecycle.push(
        state.isSnoozed
          ? { id: "unsnooze", label: "Wake thread", icon: "alarm-off" }
          : {
              id: "snooze",
              label: "Snooze",
              icon: "clock",
              disabled: !state.canSnoozeNow,
              children: state.snoozePresets.map((preset) => ({
                id: `snooze:${preset.id}` as const,
                label: `${preset.label} (${preset.whenLabel})`,
              })),
            },
      );
    }
  }

  const edit: ContextMenuItem<ThreadActionMenuId>[] = [
    { id: "rename", label: "Rename thread", icon: "pencil" },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle ? "Regenerating…" : "Regenerate title",
            icon: "refresh",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    { id: "mark-unread", label: "Mark unread", icon: "mail" },
    ...(state.supports.projectTransfer
      ? [
          {
            id: "transfer" as const,
            label: "Move to connection…",
            icon: "arrow-right-left",
            disabled: state.isRunning,
          },
        ]
      : []),
  ];

  const copy: ContextMenuItem<ThreadActionMenuId> = {
    id: "copy",
    label: "Copy",
    icon: "copy",
    activateOnClick: true,
    children: [
      { id: "copy-conversation", label: "Conversation", icon: "copy" },
      { id: "copy-path", label: "Path", icon: "folder" },
      ...(state.branch
        ? [{ id: "copy-branch" as const, label: "Branch", icon: "git-branch" }]
        : []),
      { id: "copy-thread-id", label: "Thread ID", icon: "hash" },
    ],
  };

  const danger: ContextMenuItem<ThreadActionMenuId>[] = [
    // Archive removes the thread from the sidebar while keeping its
    // conversation under Settings > Archived threads — distinct from Settle
    // (stays visible in the Settled shelf) and Delete (clears history for
    // good), so it sits beside Delete without borrowing its destructive
    // styling.
    {
      id: "archive",
      label: "Archive thread",
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    { id: "delete", label: "Delete", destructive: true, icon: "trash" },
  ];

  return joinGroups([lifecycle, edit, [copy], danger]);
}
