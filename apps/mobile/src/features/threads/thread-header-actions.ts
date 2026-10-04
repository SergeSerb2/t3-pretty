import type { GitQuickAction } from "@t3tools/client-runtime/state/vcs";

export type ThreadHeaderSettlePresentation = {
  readonly accessibilityLabel: string;
  readonly label: string;
  readonly icon: "checkmark.circle" | "arrow.uturn.backward";
  readonly disabled: boolean;
  readonly action: "settle" | "unsettle";
};

export function resolveThreadHeaderSettlePresentation(input: {
  readonly supported: boolean;
  readonly settled: boolean;
  readonly canSettle: boolean;
}): ThreadHeaderSettlePresentation {
  if (input.settled) {
    return {
      accessibilityLabel: "Un-settle thread",
      label: "Un-settle",
      icon: "arrow.uturn.backward",
      disabled: !input.supported,
      action: "unsettle",
    };
  }

  return {
    accessibilityLabel: "Settle thread",
    label: "Settle",
    icon: "checkmark.circle",
    disabled: !input.supported || !input.canSettle,
    action: "settle",
  };
}

export type ThreadHeaderSnoozePresentation = {
  readonly accessibilityLabel: string;
  readonly label: string;
  readonly icon: "clock" | "tray.and.arrow.up";
  readonly disabled: boolean;
  readonly action: "snooze-menu" | "wake" | "unstore";
  /** The snooze menu ends with Store: the no-wake-time way to park a thread. */
  readonly offersStore: boolean;
};

/**
 * The header's parking slot. Snoozed threads wake from it and stored threads
 * leave the Stored shelf from it; otherwise it opens the snooze presets,
 * followed by Store when the server supports it, so the header keeps three
 * buttons.
 */
export function resolveThreadHeaderSnoozePresentation(input: {
  readonly supported: boolean;
  readonly snoozed: boolean;
  readonly canSnooze: boolean;
  readonly storageSupported?: boolean;
  readonly stored?: boolean;
}): ThreadHeaderSnoozePresentation {
  const storageSupported = input.storageSupported === true;
  if (input.stored === true && storageSupported) {
    return {
      accessibilityLabel: "Unstore thread",
      label: "Unstore",
      icon: "tray.and.arrow.up",
      disabled: false,
      action: "unstore",
      offersStore: false,
    };
  }

  if (input.snoozed) {
    return {
      accessibilityLabel: "Wake thread",
      label: "Wake",
      icon: "clock",
      disabled: !input.supported,
      action: "wake",
      offersStore: false,
    };
  }

  return {
    accessibilityLabel: "Snooze thread",
    label: "Snooze",
    icon: "clock",
    disabled: !input.supported || !input.canSnooze,
    action: "snooze-menu",
    offersStore: storageSupported,
  };
}

export type ThreadHeaderPrMenuItemId = "view" | "create" | "review" | "files" | "more";

export type ThreadHeaderPrMenuItem = {
  readonly id: ThreadHeaderPrMenuItemId;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly iconName: string;
};

export type ThreadHeaderPrPresentation = {
  readonly accessibilityLabel: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly items: ReadonlyArray<ThreadHeaderPrMenuItem>;
};

export function isCreatePullRequestQuickAction(
  quickAction: Pick<GitQuickAction, "kind" | "action">,
): boolean {
  return (
    quickAction.kind === "run_action" &&
    (quickAction.action === "create_pr" || quickAction.action === "commit_push_pr")
  );
}

export function resolveThreadHeaderPrPresentation(input: {
  readonly hasOpenPr: boolean;
  readonly prNumber: number | null;
  readonly isRepo: boolean;
  readonly canOpenFiles: boolean;
  readonly quickAction: Pick<GitQuickAction, "kind" | "action" | "label" | "disabled" | "hint">;
}): ThreadHeaderPrPresentation {
  const reviewItem: ThreadHeaderPrMenuItem = {
    id: "review",
    label: "Review changes",
    description: "Turn diffs and worktree changes",
    disabled: !input.isRepo,
    iconName: "text.bubble",
  };
  const filesItem: ThreadHeaderPrMenuItem = {
    id: "files",
    label: "Files",
    description: "Browse the workspace",
    disabled: !input.canOpenFiles,
    iconName: "folder",
  };
  const moreItem: ThreadHeaderPrMenuItem = {
    id: "more",
    label: "More",
    description: "Commit, push, branches",
    iconName: "ellipsis",
  };

  if (input.hasOpenPr) {
    const numberLabel = input.prNumber === null ? "" : ` #${input.prNumber}`;
    return {
      accessibilityLabel: `Pull request${numberLabel}`,
      label: "Pull request",
      disabled: false,
      items: [
        {
          id: "view",
          label: input.prNumber === null ? "View PR" : `View PR #${input.prNumber}`,
          iconName: "arrow.triangle.pull",
        },
        reviewItem,
        filesItem,
        moreItem,
      ],
    };
  }

  const canCreate =
    isCreatePullRequestQuickAction(input.quickAction) && !input.quickAction.disabled;
  return {
    accessibilityLabel: "Pull request",
    label: "Pull request",
    disabled: false,
    items: [
      {
        id: "create",
        label: canCreate ? input.quickAction.label : "Create pull request",
        description: canCreate
          ? undefined
          : (input.quickAction.hint ?? "This branch is not ready for a pull request."),
        disabled: !canCreate,
        iconName: "arrow.up.right.circle",
      },
      reviewItem,
      filesItem,
      moreItem,
    ],
  };
}
