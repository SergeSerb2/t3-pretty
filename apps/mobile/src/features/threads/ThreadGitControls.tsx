import {
  EnvironmentId,
  type GitRunStackedActionResult,
  ThreadId,
  type VcsStatusResult,
} from "@t3tools/contracts";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import {
  type GitActionRequestInput,
  requiresDefaultBranchConfirmation,
  resolveQuickAction,
} from "@t3tools/client-runtime/state/vcs";
import { resolveAutomatedReviewPresentation } from "@t3tools/shared/sourceControl";
import { useNavigation } from "@react-navigation/native";
import { Alert } from "react-native";
import { NativeHeaderToolbar } from "../../native/StackHeader";
import { presentActionListMenu } from "../../components/AppMenuHost";
import { useCallback, useMemo } from "react";
import { useOpenNativePullRequest } from "../pull-requests/useOpenNativePullRequest";
import {
  resolveThreadHeaderPrPresentation,
  resolveThreadHeaderSettlePresentation,
  resolveThreadHeaderSnoozePresentation,
  type ThreadHeaderPrPresentation,
} from "./thread-header-actions";
import { resolveThreadListV2SnoozeMenuSelection } from "./threadListV2";

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const headLength = Math.ceil((maxLength - 1) / 2);
  const tailLength = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, headLength)}…${value.slice(value.length - tailLength)}`;
}

function compactMenuBranchLabel(branch: string): string {
  return truncateMiddle(branch, 24);
}

function compactMenuStatus(gitStatus: VcsStatusResult | null): string {
  if (!gitStatus) {
    return "Checking status";
  }
  if (!gitStatus.isRepo) {
    return "Not a repo";
  }

  const parts: string[] = [];
  if (gitStatus.hasWorkingTreeChanges) {
    parts.push(`${gitStatus.workingTree.files.length} changed`);
  } else if (gitStatus.aheadCount === 0 && gitStatus.behindCount === 0) {
    parts.push("Clean");
  }
  if (gitStatus.aheadCount > 0) {
    parts.push(`${gitStatus.aheadCount} ahead`);
  }
  if (gitStatus.behindCount > 0) {
    parts.push(`${gitStatus.behindCount} behind`);
  }
  if (gitStatus.pr?.state === "open") {
    parts.push(`PR #${gitStatus.pr.number}`);
    const automatedReview = resolveAutomatedReviewPresentation(gitStatus.pr.automatedReview);
    if (automatedReview) {
      parts.push(automatedReview.label);
    }
  }

  return parts.join(" · ");
}

type HeaderItem = Record<string, unknown>;
type HeaderItems = HeaderItem[];
type ThreadDetailHeaderActionItems = {
  readonly settle: HeaderItem;
  readonly snooze: HeaderItem;
  readonly pr: HeaderItem;
};
type QuickActionIcon =
  | "arrow.down.circle"
  | "arrow.up.right.circle"
  | "checkmark.circle"
  | "arrow.up.circle";

/** The subset of git-control wiring the standalone git menu needs. */
export type ThreadGitMenuProps = {
  readonly environmentId: EnvironmentId | string;
  readonly threadId: ThreadId | string;
  readonly currentBranch: string | null;
  readonly gitStatus: VcsStatusResult | null;
  readonly gitOperationLabel: string | null;
  readonly onOpenFilesInspector?: () => void;
  readonly onOpenGitInspector?: () => void;
  readonly onPull: () => Promise<void>;
  readonly onRunAction: (input: GitActionRequestInput) => Promise<GitRunStackedActionResult | null>;
};

type ThreadGitControlsProps = ThreadGitMenuProps & {
  readonly auxiliaryPaneControl?: {
    readonly accessibilityLabel: string;
    readonly onPress: () => void;
  };
  readonly showActionControls?: boolean;
  readonly canOpenFiles: boolean;
  readonly settlementSupported: boolean;
  readonly snoozeSupported: boolean;
  readonly settled: boolean;
  readonly snoozed: boolean;
  readonly canSettleThread: boolean;
  readonly canSnoozeThread: boolean;
  readonly onSettle: () => void;
  readonly onUnsettle: () => void;
  readonly onSnooze: (snoozedUntil: string) => void;
  readonly onUnsnooze: () => void;
};

function presentSnoozePresetMenu(onSnooze: (snoozedUntil: string) => void): void {
  const displayedPresets = resolveSnoozePresets(new Date());
  presentActionListMenu({
    placement: "top-end",
    title: "Snooze",
    items: displayedPresets.map((preset) => ({
      description: preset.whenLabel,
      iconName: "clock",
      label: preset.label,
      onPress: () => {
        const selection = resolveThreadListV2SnoozeMenuSelection({
          event: `snooze:${preset.id}`,
          displayedPresets,
          now: new Date(),
        });
        if (selection._tag === "selected") {
          onSnooze(selection.preset.snoozedUntil);
          return;
        }
        if (selection._tag === "expired") {
          Alert.alert(
            "Could not snooze thread",
            "That snooze time has passed. Choose another time.",
          );
        }
      },
    })),
  });
}

function presentPullRequestMenu(
  presentation: ThreadHeaderPrPresentation,
  handlers: {
    readonly onView: () => void;
    readonly onCreate: () => void;
    readonly onReview: () => void;
    readonly onFiles: () => void;
    readonly onMore: () => void;
  },
): void {
  presentActionListMenu({
    placement: "top-end",
    title: "Pull request",
    items: presentation.items.map((item) => ({
      description: item.description,
      disabled: item.disabled,
      iconName: item.iconName,
      label: item.label,
      onPress: () => {
        if (item.id === "view") handlers.onView();
        if (item.id === "create") handlers.onCreate();
        if (item.id === "review") handlers.onReview();
        if (item.id === "files") handlers.onFiles();
        if (item.id === "more") handlers.onMore();
      },
    })),
  });
}

function useThreadGitControlModel(props: ThreadGitMenuProps) {
  const navigation = useNavigation();
  const environmentId = props.environmentId;
  const threadId = props.threadId;
  const { gitStatus, gitOperationLabel, onPull, onRunAction } = props;

  const currentBranchLabel = gitStatus?.refName ?? props.currentBranch ?? "Detached HEAD";
  const busy = gitOperationLabel !== null;
  const isRepo = gitStatus?.isRepo ?? true;
  const hasPrimaryRemote = gitStatus?.hasPrimaryRemote ?? false;
  const isDefaultRef = gitStatus?.isDefaultRef ?? false;

  const quickAction = useMemo(
    () =>
      isRepo
        ? resolveQuickAction(gitStatus, busy, isDefaultRef, hasPrimaryRemote)
        : {
            label: "Git unavailable",
            disabled: true,
            kind: "show_hint" as const,
            hint: "This workspace is not a git repository.",
          },
    [busy, gitStatus, hasPrimaryRemote, isDefaultRef, isRepo],
  );

  const quickActionHint = quickAction.disabled
    ? (quickAction.hint ?? "This action is unavailable.")
    : null;

  const quickActionIcon: QuickActionIcon = (() => {
    if (quickAction.kind === "run_pull") return "arrow.down.circle";
    if (quickAction.kind === "open_pr") return "arrow.up.right.circle";
    if (quickAction.kind === "run_action") {
      if (quickAction.action === "commit") return "checkmark.circle";
      if (quickAction.action === "push" || quickAction.action === "commit_push")
        return "arrow.up.circle";
    }
    return "arrow.up.right.circle";
  })();

  const openNativePullRequest = useOpenNativePullRequest();

  const openExistingPr = useCallback(async () => {
    const pr = gitStatus?.pr?.state === "open" ? gitStatus.pr : null;
    await openNativePullRequest({
      url: pr?.url,
      number: pr?.number,
    });
  }, [gitStatus, openNativePullRequest]);

  const runActionWithPrompt = useCallback(
    async (input: GitActionRequestInput) => {
      const confirmableAction =
        input.action === "push" ||
        input.action === "create_pr" ||
        input.action === "commit_push" ||
        input.action === "commit_push_pr"
          ? input.action
          : null;
      const branchName = gitStatus?.refName;
      if (
        branchName &&
        confirmableAction &&
        !input.featureBranch &&
        requiresDefaultBranchConfirmation(input.action, isDefaultRef)
      ) {
        navigation.navigate("GitConfirm", {
          environmentId: String(environmentId),
          threadId: String(threadId),
          confirmAction: confirmableAction,
          branchName,
          includesCommit: String(
            input.action === "commit_push" || input.action === "commit_push_pr",
          ),
        });
        return;
      }

      await onRunAction(input);
    },
    [environmentId, gitStatus, isDefaultRef, onRunAction, navigation, threadId],
  );

  const runQuickAction = useCallback(async () => {
    if (quickAction.kind === "open_pr") {
      await openExistingPr();
      return;
    }
    if (quickAction.kind === "run_pull") {
      await onPull();
      return;
    }
    if (quickAction.kind === "run_action" && quickAction.action) {
      await runActionWithPrompt({ action: quickAction.action });
    }
  }, [onPull, openExistingPr, quickAction, runActionWithPrompt]);

  const openFiles = useCallback(() => {
    if (props.onOpenFilesInspector) {
      props.onOpenFilesInspector();
      return;
    }
    navigation.navigate("ThreadFiles", {
      environmentId: String(environmentId),
      threadId: String(threadId),
    });
  }, [environmentId, props.onOpenFilesInspector, navigation, threadId]);

  const openReview = useCallback(() => {
    navigation.navigate("ThreadReview", {
      environmentId: EnvironmentId.make(String(environmentId)),
      threadId: ThreadId.make(String(threadId)),
    });
  }, [environmentId, navigation, threadId]);

  const openGitInspector = useCallback(() => {
    if (props.onOpenGitInspector) {
      props.onOpenGitInspector();
      return;
    }
    navigation.navigate("GitOverview", {
      environmentId: String(environmentId),
      threadId: String(threadId),
    });
  }, [environmentId, props.onOpenGitInspector, navigation, threadId]);

  return {
    currentBranchLabel,
    isRepo,
    openExistingPr,
    openFiles,
    openGitInspector,
    openReview,
    quickAction,
    quickActionHint,
    quickActionIcon,
    runQuickAction,
  };
}

export function useThreadDetailHeaderActionItems(
  props: ThreadGitControlsProps,
): ThreadDetailHeaderActionItems {
  const model = useThreadGitControlModel(props);
  const settle = resolveThreadHeaderSettlePresentation({
    supported: props.settlementSupported,
    settled: props.settled,
    canSettle: props.canSettleThread,
  });
  const snooze = resolveThreadHeaderSnoozePresentation({
    supported: props.snoozeSupported,
    snoozed: props.snoozed,
    canSnooze: props.canSnoozeThread,
  });
  const openPr = props.gitStatus?.pr?.state === "open" ? props.gitStatus.pr : null;
  const pr = resolveThreadHeaderPrPresentation({
    hasOpenPr: openPr !== null,
    prNumber: openPr?.number ?? null,
    isRepo: model.isRepo,
    canOpenFiles: props.canOpenFiles,
    quickAction: model.quickAction,
  });

  return useMemo(
    () => ({
      settle: {
        accessibilityLabel: settle.accessibilityLabel,
        disabled: settle.disabled,
        icon: { name: settle.icon, type: "sfSymbol" },
        identifier: "thread-right-settle",
        label: settle.label,
        onPress: settle.action === "unsettle" ? props.onUnsettle : props.onSettle,
        sharesBackground: true,
        type: "button",
        variant: "plain",
      },
      snooze: {
        accessibilityLabel: snooze.accessibilityLabel,
        disabled: snooze.disabled,
        icon: { name: snooze.icon, type: "sfSymbol" },
        identifier: "thread-right-snooze",
        label: snooze.label,
        onPress:
          snooze.action === "wake"
            ? props.onUnsnooze
            : () => presentSnoozePresetMenu(props.onSnooze),
        sharesBackground: true,
        type: "button",
        variant: "plain",
      },
      pr: {
        accessibilityLabel: pr.accessibilityLabel,
        disabled: pr.disabled,
        icon: { name: "arrow.triangle.pull", type: "sfSymbol" },
        identifier: "thread-right-pr",
        label: pr.label,
        onPress: () =>
          presentPullRequestMenu(pr, {
            onView: () => void model.openExistingPr(),
            onCreate: () => void model.runQuickAction(),
            onReview: model.openReview,
            onFiles: model.openFiles,
            onMore: model.openGitInspector,
          }),
        sharesBackground: true,
        type: "button",
        variant: "plain",
      },
    }),
    [
      model.isRepo,
      model.openExistingPr,
      model.openFiles,
      model.openGitInspector,
      model.openReview,
      model.quickAction,
      model.runQuickAction,
      openPr,
      pr,
      props.canOpenFiles,
      props.canSettleThread,
      props.canSnoozeThread,
      props.onSettle,
      props.onSnooze,
      props.onUnsnooze,
      props.onUnsettle,
      props.settled,
      props.settlementSupported,
      props.snoozeSupported,
      props.snoozed,
      settle,
      snooze,
    ],
  );
}

export function useThreadGitRightHeaderItems(props: ThreadGitControlsProps): HeaderItems {
  const actionItems = useThreadDetailHeaderActionItems(props);
  return useMemo(
    // headerRightItems lay out first-item-trailing, so this reads Settle, Snooze, PR.
    () => [actionItems.pr, actionItems.snooze, actionItems.settle] as HeaderItems,
    [actionItems],
  );
}

export function useThreadGitCenterHeaderItems(props: ThreadGitControlsProps): HeaderItems {
  return useThreadGitRightHeaderItems(props);
}

export function ThreadGitControls(props: ThreadGitControlsProps) {
  const model = useThreadGitControlModel(props);
  const showActionControls = props.showActionControls ?? true;
  const settle = resolveThreadHeaderSettlePresentation({
    supported: props.settlementSupported,
    settled: props.settled,
    canSettle: props.canSettleThread,
  });
  const snooze = resolveThreadHeaderSnoozePresentation({
    supported: props.snoozeSupported,
    snoozed: props.snoozed,
    canSnooze: props.canSnoozeThread,
  });
  const openPr = props.gitStatus?.pr?.state === "open" ? props.gitStatus.pr : null;
  const pr = resolveThreadHeaderPrPresentation({
    hasOpenPr: openPr !== null,
    prNumber: openPr?.number ?? null,
    isRepo: model.isRepo,
    canOpenFiles: props.canOpenFiles,
    quickAction: model.quickAction,
  });
  const snoozePresets = resolveSnoozePresets(new Date());

  if (!showActionControls) {
    return null;
  }

  return (
    <NativeHeaderToolbar placement="right">
      {props.auxiliaryPaneControl ? (
        <NativeHeaderToolbar.Button
          accessibilityLabel={props.auxiliaryPaneControl.accessibilityLabel}
          icon="sidebar.right"
          onPress={props.auxiliaryPaneControl.onPress}
          separateBackground
        />
      ) : null}
      <NativeHeaderToolbar.Menu
        accessibilityLabel={pr.accessibilityLabel}
        icon="arrow.triangle.pull"
      >
        {pr.items.map((item) => (
          <NativeHeaderToolbar.MenuAction
            key={item.id}
            disabled={item.disabled}
            icon={item.iconName}
            onPress={() => {
              if (item.id === "view") void model.openExistingPr();
              if (item.id === "create") void model.runQuickAction();
              if (item.id === "review") model.openReview();
              if (item.id === "files") model.openFiles();
              if (item.id === "more") model.openGitInspector();
            }}
            subtitle={item.description}
          >
            <NativeHeaderToolbar.Label>{item.label}</NativeHeaderToolbar.Label>
          </NativeHeaderToolbar.MenuAction>
        ))}
      </NativeHeaderToolbar.Menu>
      {snooze.action === "wake" ? (
        <NativeHeaderToolbar.Button
          accessibilityLabel={snooze.accessibilityLabel}
          disabled={snooze.disabled}
          icon={snooze.icon}
          onPress={props.onUnsnooze}
        />
      ) : (
        <NativeHeaderToolbar.Menu
          accessibilityLabel={snooze.accessibilityLabel}
          disabled={snooze.disabled}
          icon={snooze.icon}
        >
          {snoozePresets.map((preset) => (
            <NativeHeaderToolbar.MenuAction
              key={preset.id}
              icon="clock"
              onPress={() => {
                const selection = resolveThreadListV2SnoozeMenuSelection({
                  event: `snooze:${preset.id}`,
                  displayedPresets: snoozePresets,
                  now: new Date(),
                });
                if (selection._tag === "selected") {
                  props.onSnooze(selection.preset.snoozedUntil);
                  return;
                }
                if (selection._tag === "expired") {
                  Alert.alert(
                    "Could not snooze thread",
                    "That snooze time has passed. Choose another time.",
                  );
                }
              }}
              subtitle={preset.whenLabel}
            >
              <NativeHeaderToolbar.Label>{preset.label}</NativeHeaderToolbar.Label>
            </NativeHeaderToolbar.MenuAction>
          ))}
        </NativeHeaderToolbar.Menu>
      )}
      <NativeHeaderToolbar.Button
        accessibilityLabel={settle.accessibilityLabel}
        disabled={settle.disabled}
        icon={settle.icon}
        onPress={settle.action === "unsettle" ? props.onUnsettle : props.onSettle}
      />
    </NativeHeaderToolbar>
  );
}

/**
 * The standalone git actions menu (branch status, quick commit/push action,
 * review, more). Rendered inside a NativeHeaderToolbar by both the thread
 * chat header and the review screen's toolbar.
 */
export function ThreadGitMenu(props: ThreadGitMenuProps) {
  const model = useThreadGitControlModel(props);

  return (
    <NativeHeaderToolbar.Menu icon="point.topleft.down.curvedto.point.bottomright.up">
      <NativeHeaderToolbar.MenuAction
        icon="point.topleft.down.curvedto.point.bottomright.up"
        disabled
        onPress={() => {}}
        subtitle={compactMenuStatus(props.gitStatus)}
      >
        <NativeHeaderToolbar.Label>
          {compactMenuBranchLabel(model.currentBranchLabel)}
        </NativeHeaderToolbar.Label>
      </NativeHeaderToolbar.MenuAction>
      <NativeHeaderToolbar.MenuAction
        icon={model.quickActionIcon}
        disabled={model.quickAction.disabled}
        onPress={() => void model.runQuickAction()}
        subtitle={model.quickActionHint ?? undefined}
      >
        <NativeHeaderToolbar.Label>{model.quickAction.label}</NativeHeaderToolbar.Label>
      </NativeHeaderToolbar.MenuAction>
      <NativeHeaderToolbar.MenuAction
        icon="text.bubble"
        disabled={!model.isRepo}
        onPress={model.openReview}
        subtitle="Turn diffs and worktree changes"
      >
        <NativeHeaderToolbar.Label>Review changes</NativeHeaderToolbar.Label>
      </NativeHeaderToolbar.MenuAction>
      <NativeHeaderToolbar.MenuAction
        icon="ellipsis"
        onPress={model.openGitInspector}
        subtitle="Commit, files, branches"
      >
        <NativeHeaderToolbar.Label>More</NativeHeaderToolbar.Label>
      </NativeHeaderToolbar.MenuAction>
    </NativeHeaderToolbar.Menu>
  );
}
