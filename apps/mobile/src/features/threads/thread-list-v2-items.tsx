import type { ThreadRowProviderInstance } from "./thread-provider-instance";
import {
  THREAD_LIST_V2_MONO_FONT as MONO_FONT,
  THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME,
  THREAD_LIST_V2_ROW_DIVIDERS,
  selectedThreadRowColors,
  getThreadListV2NewBranchMenuTitle,
  getThreadListV2RowAppearance,
} from "./thread-list-v2-row-appearance";
import { RowPressable } from "../../components/RowPressable";
import { CustomSnoozeSheet } from "./CustomSnoozeSheet";
import { appAtomRegistry } from "../../state/atom-registry";
import { threadArrangementOpenAtom } from "../../state/thread-order";
import type { ThreadMoveDestination } from "./threadOrder";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import type { EnvironmentMachineKind } from "@t3tools/contracts";
import {
  canSnooze,
  canStore,
  resolveSnoozePresets,
} from "@t3tools/client-runtime/state/thread-settled";
import type { MenuAction } from "@react-native-menu/menu";
import * as Haptics from "expo-haptics";
import {
  memo,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Alert, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import type { ThreadListProvider } from "../../state/thread-list-environments";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPill";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { ProviderIcon, ProviderInstanceIcon } from "../../components/ProviderIcon";
import { StatusPill, type StatusTone } from "../../components/StatusPill";
import { cn } from "../../lib/cn";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { useThreadPr } from "../../state/use-thread-pr";
import { useSwipeRowDormant } from "../home/swipe-row-activation";
import { ThreadSwipeable } from "../home/thread-swipe-actions";
import {
  clearThreadDeparting,
  getThreadDepartureSnapshot,
  subscribeThreadDeparture,
  threadDepartureHasLanded,
} from "../home/thread-departure-store";
import { MOTION_TIMING } from "../../lib/motion";
import { THREAD_RENAME_MENU_ACTION } from "./thread-rename";
import { buildThreadTitleRegenerationMenuItems } from "./thread-title-regeneration-menu";
import {
  THREAD_LIST_V2_SETTLED_PAGE_COUNT,
  resolveThreadListV2SnoozeGateExpiryMs,
  resolveThreadListV2SnoozeMenuSelection,
  resolveThreadListV2Badge,
  resolveThreadListV2Status,
  resolveThreadListV2ProviderDrivers,
  resolveThreadListV2SwipeActions,
  type ThreadListV2Badge,
} from "./threadListV2";
import { QueuedMessageIcon } from "./queued-message-icon";
import { ThreadActiveSubagentCount } from "./thread-active-subagent-count";
import { ThreadListGlassContext } from "./thread-list-glass-context";
import type { ThreadStatusPresentation } from "./threadPresentation";
import { ThreadSearchMatchExcerpt } from "./thread-search-match";
import { ThreadCardTile } from "./thread-card-tile";
import { ThreadDisclosureChevron } from "./thread-work-log";

/**
 * Thread List v2 renders one flat native list: rich edge-to-edge rows for
 * active work and a receded settled tail, all with native swipe and
 * long-press actions. State reads through colored status labels and text
 * hierarchy rather than card fills.
 */

// Status hues follow the system-wide convention set by sidebar v1 and the
// Live Activity/widgets (amber approval, indigo input, sky working) so a
// thread reads the same color everywhere it surfaces. Flat rows color the
// label; glass Home cards set it in a tinted pill, the automation list's look.
const STATUS_BY_BADGE: Record<
  ThreadListV2Badge,
  { label: string; className: string; pill: Omit<StatusTone, "label"> }
> = {
  approval: {
    label: "Approval",
    className: "text-warning-foreground",
    pill: {
      pillClassName: "bg-adaptive-amber-500-a12-a16",
      textClassName: "text-adaptive-amber-700-300",
    },
  },
  input: {
    label: "Input",
    className: "text-adaptive-indigo-600-300",
    pill: {
      pillClassName: "bg-adaptive-indigo-500-a12-a16",
      textClassName: "text-adaptive-indigo-600-300",
    },
  },
  working: {
    label: "Working",
    className: "text-adaptive-sky-600-400",
    pill: {
      pillClassName: "bg-adaptive-sky-500-a12-a16",
      textClassName: "text-adaptive-sky-700-300",
    },
  },
  monitoring: {
    label: "Monitoring",
    className: "text-foreground",
    pill: { pillClassName: "bg-adaptive-zinc-500-a12-a16", textClassName: "text-foreground" },
  },
  failed: {
    label: "Failed",
    className: "text-danger-foreground",
    pill: {
      pillClassName: "bg-adaptive-rose-500-a12-a16",
      textClassName: "text-adaptive-rose-700-300",
    },
  },
  done: {
    label: "Done",
    className: "text-adaptive-emerald-700-300",
    pill: {
      pillClassName: "bg-adaptive-emerald-500-a12-a16",
      textClassName: "text-adaptive-emerald-700-300",
    },
  },
  limited: {
    label: "Limited",
    className: "text-warning-foreground",
    pill: {
      pillClassName: "bg-adaptive-amber-500-a12-a16",
      textClassName: "text-adaptive-amber-700-300",
    },
  },
};

// Menus keep lifecycle and title regeneration together. Archive keeps its
// own surface (thread screen / settings) rather than crowding v2 rows.
const CARD_MENU_ACTIONS: MenuAction[] = [
  { id: "settle", title: "Settle", image: "checkmark" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const SLIM_MENU_ACTIONS: MenuAction[] = [
  { id: "unsettle", title: "Un-settle", image: "arrow.uturn.backward" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const SNOOZED_MENU_ACTIONS: MenuAction[] = [
  { id: "unsnooze", title: "Wake thread", image: "clock" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const STORE_MENU_ACTION: MenuAction = {
  id: "store",
  title: "Store",
  image: "tray.and.arrow.down",
};
const UNSTORE_MENU_ACTION: MenuAction = {
  id: "unstore",
  title: "Unstore",
  image: "tray.and.arrow.up",
};

// Pre-settlement servers: no lifecycle items, archive fills the gap.
const LEGACY_MENU_ACTIONS: MenuAction[] = [
  { id: "archive", title: "Archive", image: "archivebox" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

/** Rounded-row radius shared with the v1 sidebar rows. */
const SIDEBAR_V2_ROW_RADIUS = 12;

function ThreadListV2Section(props: {
  readonly label: string;
  /** Shelf size. Glass headers show it as a badge; flat ones fold it into
      the collapsed label. */
  readonly count?: number;
  readonly pane?: "screen" | "sidebar";
  readonly tone?: "default" | "snoozed";
  readonly disclosure?: {
    readonly expanded: boolean;
    readonly disabled?: boolean;
    readonly onToggle: () => void;
    readonly accessibilityLabel: string;
    readonly accessibilityHint: string;
  };
}) {
  const snoozed = props.tone === "snoozed";
  const sidebarPane = props.pane === "sidebar";
  // Glass cards inset 12 + pad 16: the label lines up with card text.
  const glass = use(ThreadListGlassContext) && !sidebarPane;
  const theme = useUniwindTheme();
  const className = cn(
    "mb-1.5 mt-4 flex-row items-center gap-2.5",
    sidebarPane ? "px-3" : glass ? "px-7" : "px-5",
  );
  const flatLabel =
    props.count !== undefined && props.disclosure?.expanded === false
      ? `${props.label} (${props.count})`
      : props.label;
  // Over the photo a hairline rule reads as a scratch, so glass headers are a
  // label, a frosted count badge and the disclosure chevron.
  const content: ReactNode = glass ? (
    <>
      <Text
        className={cn(
          "text-sm font-t3-bold",
          snoozed ? "text-primary" : "text-foreground-secondary",
        )}
      >
        {props.label}
      </Text>
      {props.count !== undefined ? (
        <View
          className="min-w-[22px] items-center rounded-full border-chrome-glass-border bg-chrome-glass px-1.5"
          style={{ borderWidth: StyleSheet.hairlineWidth, paddingVertical: 1 }}
        >
          <Text className="text-xs font-t3-medium tabular-nums text-foreground-muted">
            {props.count}
          </Text>
        </View>
      ) : null}
      <View className="flex-1" />
      {props.disclosure ? (
        <ThreadDisclosureChevron
          collapsedDirection="down"
          expanded={props.disclosure.expanded}
          size={11}
          tintColor={theme["--color-foreground-muted"]}
        />
      ) : null}
    </>
  ) : (
    <>
      <Text
        className={cn(
          "text-xs font-t3-medium",
          sidebarPane
            ? "text-drawer-foreground-muted"
            : snoozed
              ? "text-foreground-secondary"
              : "text-foreground-tertiary",
        )}
      >
        {flatLabel}
      </Text>
      <View
        className={cn(
          "h-px flex-1",
          snoozed ? "bg-primary/20" : sidebarPane ? "bg-drawer-border" : "bg-border",
        )}
      />
      {props.disclosure ? (
        <ThreadDisclosureChevron
          collapsedDirection="down"
          expanded={props.disclosure.expanded}
          size={10}
          tintColor={
            theme[
              sidebarPane
                ? "--color-drawer-foreground-muted"
                : snoozed
                  ? "--color-icon-muted"
                  : "--color-foreground-muted"
            ]
          }
        />
      ) : null}
    </>
  );

  const disclosure = props.disclosure;
  return disclosure ? (
    <Pressable
      accessibilityHint={disclosure.accessibilityHint}
      accessibilityLabel={disclosure.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{
        disabled: disclosure.disabled,
        expanded: disclosure.expanded,
      }}
      className={className}
      disabled={disclosure.disabled}
      onPress={() => {
        void Haptics.selectionAsync();
        disclosure.onToggle();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  ) : (
    <View className={className}>{content}</View>
  );
}

/** Section label + rule: the only structure in an otherwise flat list. */
export const ThreadListV2SectionDivider = memo(function ThreadListV2SectionDivider(props: {
  readonly label: string;
  readonly pane?: "screen" | "sidebar";
}) {
  return <ThreadListV2Section {...props} />;
});

type ThreadListV2ShelfHeaderProps = {
  readonly count: number;
  readonly disabled?: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly pane?: "screen" | "sidebar";
};

const SHELF_LABELS = {
  working: "Working",
  snoozed: "Snoozed",
  stored: "Stored",
  settled: "Settled",
} as const;

function ThreadListV2ShelfHeader(
  props: ThreadListV2ShelfHeaderProps & { readonly kind: keyof typeof SHELF_LABELS },
) {
  return (
    <ThreadListV2Section
      label={SHELF_LABELS[props.kind]}
      count={props.count}
      pane={props.pane}
      tone={props.kind === "snoozed" ? "snoozed" : "default"}
      disclosure={{
        expanded: props.expanded,
        disabled: props.disabled,
        onToggle: props.onToggle,
        accessibilityLabel: `${props.count} ${props.kind} ${props.count === 1 ? "thread" : "threads"}`,
        accessibilityHint: `${props.expanded ? "Collapses" : "Expands"} the ${props.kind} threads.`,
      }}
    />
  );
}

export const ThreadListV2WorkingShelfHeader = memo(function ThreadListV2WorkingShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="working" />;
});

export const ThreadListV2SnoozedShelfHeader = memo(function ThreadListV2SnoozedShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="snoozed" />;
});

export const ThreadListV2StoredShelfHeader = memo(function ThreadListV2StoredShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="stored" />;
});

export const ThreadListV2SettledShelfHeader = memo(function ThreadListV2SettledShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="settled" />;
});

export const ThreadListV2ShowMoreRow = memo(function ThreadListV2ShowMoreRow(props: {
  readonly pane?: "screen" | "sidebar";
  readonly hiddenCount: number;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${Math.min(props.hiddenCount, THREAD_LIST_V2_SETTLED_PAGE_COUNT)} more settled threads`}
      onPress={props.onPress}
      className="mx-4 mt-2 items-center rounded-lg border border-dashed border-border py-2.5"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Text
        className={
          props.pane === "sidebar"
            ? "text-xs font-t3-medium text-drawer-foreground-muted"
            : "text-xs font-t3-medium text-foreground-muted"
        }
      >
        Show more ({props.hiddenCount} settled hidden)
      </Text>
    </Pressable>
  );
});

const PENDING_TASK_MENU_ACTIONS: MenuAction[] = [
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const DRAFT_TASK_MENU_ACTIONS: MenuAction[] = [
  { id: "delete", title: "Discard", image: "trash", attributes: { destructive: true } },
];

/**
 * Unsent work, in the same idiom as an active v2 row: it is work the user
 * wrote, so it reads like the thread it will become. The status slot says
 * what happens next, not where the item sits: "Sends on reconnect" stays
 * uncolored because nothing is asked of the user; "Draft" takes the amber the
 * web sidebar uses for drafts, because this one waits on the user.
 */
export const ThreadListV2PendingRow = memo(function ThreadListV2PendingRow(props: {
  readonly pendingTask: PendingNewTask;
  readonly project: EnvironmentProject | null;
  readonly projectTitle?: string;
  readonly environmentLabel: string | null;
  /** Drawn beside the label; ignored while the label is null. */
  readonly environmentMachine?: EnvironmentMachineKind;
  readonly pane?: "screen" | "sidebar";
  /** Draws the "Unsent" divider above the first draft or queued row. */
  readonly showPendingDivider: boolean;
  /** Keeps row hairlines inside a section; section headers draw their own rule. */
  readonly showTrailingDivider?: boolean;
  readonly onSelectPendingTask: (pendingTask: PendingNewTask) => void;
  readonly onDeletePendingTask: (pendingTask: PendingNewTask) => void;
}) {
  const { pendingTask, onSelectPendingTask, onDeletePendingTask } = props;
  const sidebarPane = props.pane === "sidebar";
  const glass = use(ThreadListGlassContext) && !sidebarPane;
  const theme = useUniwindTheme();
  const glassAppearance = glass ? getThreadListV2RowAppearance(theme, false, false, true) : null;
  const isDraft = pendingTask.kind === "draft";
  const projectTitle = props.projectTitle ?? props.project?.title ?? pendingTask.projectTitle ?? "";
  const branch = pendingTask.branch;

  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "delete") onDeletePendingTask(pendingTask);
    },
    [onDeletePendingTask, pendingTask],
  );

  const rowContent = (
    <>
      <View className="flex-row items-center gap-1.5">
        {props.project && !glassAppearance ? (
          <ProjectFavicon
            environmentId={pendingTask.environmentId}
            faviconPath={props.project.faviconPath}
            projectIcon={props.project.projectIcon}
            size={15}
            projectTitle={props.project.title}
            workspaceRoot={props.project.workspaceRoot}
          />
        ) : null}
        <Text
          className={cn(
            "flex-1 text-sm font-t3-medium text-foreground-muted",
            sidebarPane && "text-drawer-foreground-muted",
          )}
          numberOfLines={1}
        >
          {projectTitle}
        </Text>
        {isDraft ? (
          <View className="flex-row items-center gap-1">
            <SymbolView
              name="square.and.pencil"
              size={10}
              tintColorClassName="accent-adaptive-amber-700-300"
              type="monochrome"
            />
            <Text className="text-xs text-adaptive-amber-700-300">Draft</Text>
          </View>
        ) : (
          <Text
            className={cn(
              "text-xs text-foreground-tertiary",
              sidebarPane && "text-drawer-foreground-muted",
            )}
          >
            Sends on reconnect
          </Text>
        )}
      </View>
      {/* One line, unlike the two an active row allows: a queued title is
          derived from the whole prompt rather than written as a title, so the
          second line is usually a stray word or emoji rather than meaning. */}
      <Text
        className={cn(
          "mt-1 text-base font-t3-medium text-foreground",
          sidebarPane && "text-drawer-foreground",
        )}
        numberOfLines={1}
      >
        {pendingTask.title}
      </Text>
      {branch || props.environmentLabel ? (
        <View className="mt-1 flex-row items-center gap-1">
          <Text
            className={cn(
              "shrink text-xs text-foreground-muted",
              sidebarPane && "text-drawer-foreground-muted",
            )}
            numberOfLines={1}
          >
            {branch ? (
              <Text
                className={cn(
                  "text-xs text-foreground-muted",
                  sidebarPane && "text-drawer-foreground-muted",
                )}
                style={{ fontFamily: MONO_FONT }}
              >
                {branch}
              </Text>
            ) : null}
            {branch && props.environmentLabel ? "  ·  " : null}
            {props.environmentLabel ? (
              <Text
                className={cn(
                  "text-xs text-foreground-tertiary",
                  sidebarPane && "text-drawer-foreground-muted",
                )}
              >
                {props.environmentLabel}
              </Text>
            ) : null}
          </Text>
          {props.environmentLabel && props.environmentMachine ? (
            <EnvironmentMachineSymbol
              kind={props.environmentMachine}
              size={11}
              tintColorClassName={
                sidebarPane ? "accent-drawer-foreground-muted" : "accent-foreground-tertiary"
              }
            />
          ) : null}
        </View>
      ) : null}
    </>
  );

  return (
    <>
      {props.showPendingDivider ? (
        <ThreadListV2SectionDivider label="Unsent" pane={props.pane} />
      ) : null}
      <ControlPillMenu
        actions={isDraft ? DRAFT_TASK_MENU_ACTIONS : PENDING_TASK_MENU_ACTIONS}
        onPressAction={handleMenuAction}
        shouldOpenOnLongPress
      >
        <RowPressable
          accessibilityHint={
            isDraft
              ? "Opens the draft in the new task composer"
              : "Sends when the environment reconnects. Opens the task for editing"
          }
          accessibilityLabel={pendingTask.title}
          accessibilityRole="button"
          key={pendingTask.key}
          className={glassAppearance ? undefined : sidebarPane ? "bg-drawer" : "bg-screen"}
          interactionClassName={
            glassAppearance
              ? glassAppearance.interactionClassName
              : sidebarPane
                ? "bg-thread-hover"
                : "bg-row-hover"
          }
          onPress={() => onSelectPendingTask(pendingTask)}
          style={
            glassAppearance
              ? [glassAppearance.swipeContainerStyle, glassAppearance.cardStyle]
              : sidebarPane
                ? {
                    borderRadius: SIDEBAR_V2_ROW_RADIUS,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }
                : undefined
          }
        >
          {sidebarPane ? (
            rowContent
          ) : glassAppearance ? (
            <>
              <View className="flex-row items-start gap-3 px-4 py-3">
                <ThreadCardTile
                  environmentId={pendingTask.environmentId}
                  photoURL={null}
                  project={props.project}
                />
                <View className="min-w-0 flex-1">{rowContent}</View>
              </View>
              <View
                pointerEvents="none"
                style={[glassAppearance.outlineStyle, StyleSheet.absoluteFill]}
              />
            </>
          ) : (
            <View>
              <View className="px-5 py-2.5">{rowContent}</View>
              {props.showTrailingDivider !== false ? (
                <View className="ml-5 h-px bg-border-subtle" />
              ) : null}
            </View>
          )}
        </RowPressable>
      </ControlPillMenu>
    </>
  );
});

export const ThreadListV2Row = memo(function ThreadListV2Row(props: {
  readonly thread: EnvironmentThreadShell;
  readonly variant: "card" | "slim";
  /** A message for this thread is waiting in the outbox. */
  readonly hasQueuedMessages?: boolean;
  /** Snoozed-shelf row: shows its wake time and offers Wake. */
  readonly snoozed?: boolean;
  /** Stored-shelf row: offers Unstore. */
  readonly stored?: boolean;
  /** Pinned-block row: shows the pin glyph and offers Unpin. */
  readonly pinned?: boolean;
  /** Preformatted against the parent minute tick so this memoized row's
      countdown keeps moving. */
  readonly snoozeWakeLabelText?: string;
  /** Preformatted against the parent clock (row order timestamp: settle stamp
      on settled rows, latest activity otherwise). Blank while a status label
      or the wake countdown owns that slot. Precomputed per row — not via the
      list's extraData — so the minute tick re-renders only rows whose
      displayed text moved. */
  readonly timeLabel: string;
  /** Parent minute tick carried on the row's list item, present only when the
      row's menu offers snooze presets, so those menus refresh while mounted
      without invalidating every other row. */
  readonly snoozePresetMinute: string;
  readonly project: EnvironmentProject | null;
  readonly projectTitle?: string;
  /** Keep the environment's provider array stable across unrelated list updates. */
  readonly providers: ReadonlyArray<ThreadListProvider> | undefined;
  readonly providerInstance: ThreadRowProviderInstance | null;
  /** Which machine hosts the thread. Null when only one environment is
      connected — repeating the same label on every row is noise. Mirrors
      the web sidebar's remote-environment cloud icon, but as text since
      phones have no hover tooltips. */
  readonly environmentLabel: string | null;
  /** Drawn after the label so the machine reads at a glance; ignored while
      the label is null. */
  readonly environmentMachine?: EnvironmentMachineKind;
  /** Hosting surface. "screen" (default) renders the compact Home idiom:
      flat edge-to-edge rows on the screen background with inset hairlines.
      "sidebar" renders the iPad split-view idiom: rounded rows blending
      into the drawer surface, selection filled with the accent color —
      matching the v1 sidebar rows. */
  readonly pane?: "screen" | "sidebar";
  /** Keeps row hairlines inside a section; section headers draw their own rule. */
  readonly showTrailingDivider?: boolean;
  /** Slim row directly below another slim row; glass rows join into one card. */
  readonly continuesGroup?: boolean;
  /** Photo for a glass Home card's leading tile (see ThreadCardTile). */
  readonly sceneryThumbURL?: string | null;
  /** Highlights the thread open in the detail pane (iPad split view). The
      compact Home list never sets it — phones navigate away on select. */
  readonly selected?: boolean;
  /** Override for narrow panes (iPad sidebar); defaults to window width. */
  readonly fullSwipeWidth?: number;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onDeleteThread: (thread: EnvironmentThreadShell) => void;
  readonly onNewThreadOnBranch: (thread: EnvironmentThreadShell) => void;
  readonly onRegenerateThreadTitle: (thread: EnvironmentThreadShell) => void;
  readonly onRenameThread: (thread: EnvironmentThreadShell) => void;
  readonly onSettleThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly onSnoozeThread: (thread: EnvironmentThreadShell, snoozedUntil: string) => void;
  readonly onUnsnoozeThread: (thread: EnvironmentThreadShell) => void;
  readonly onStoreThread: (thread: EnvironmentThreadShell) => void;
  readonly onUnstoreThread: (thread: EnvironmentThreadShell) => void;
  readonly onUnsettleThread: (thread: EnvironmentThreadShell) => void;
  readonly onArchiveThread: (thread: EnvironmentThreadShell) => void;
  readonly onPinThread: (thread: EnvironmentThreadShell) => void;
  readonly onUnpinThread: (thread: EnvironmentThreadShell) => void;
  readonly onSetThreadAutoSettle: (thread: EnvironmentThreadShell, enabled: boolean) => void;
  /** False on environments whose server predates thread.settle/unsettle:
      swipe + menu fall back to Archive instead of failing on use. */
  readonly settlementSupported: boolean;
  /** False on servers that predate thread.snooze/unsnooze. */
  readonly snoozeSupported: boolean;
  /** False on servers that predate thread.store/unstore. */
  readonly storageSupported: boolean;
  /** False on servers that predate thread.pin/unpin. */
  readonly pinningSupported: boolean;
  /** False on servers that predate thread.auto-settle.set. */
  readonly autoSettleOptOutSupported: boolean;
  /** False on servers that predate thread title regeneration. */
  readonly titleRegenerationSupported: boolean;
  readonly nest?: "parent" | "child" | null;
  readonly childCount?: number;
  readonly nestExpanded?: boolean;
  readonly collapsedNestStatus?: ThreadStatusPresentation | null;
  readonly pullRequestKey?: string | null;
  readonly onToggleNest?: (pullRequestKey: string) => void;
  /** Server supports reordering this card's section. */
  readonly reorderSupported?: boolean;
  readonly onMoveThread?: (
    thread: EnvironmentThreadShell,
    direction: ThreadMoveDestination,
  ) => void;
  /** Position flags for the card's section so the menu disables the move that
      would fall off the end of the list. */
  readonly canMoveUp?: boolean;
  readonly canMoveDown?: boolean;
  readonly onSwipeableWillOpen: (methods: SwipeableMethods) => void;
  readonly onSwipeableClose: (methods: SwipeableMethods) => void;
  /** List key checked against the Home swipe row activation. */
  readonly activationKey?: string;
  readonly searchMatch?: EnvironmentThreadSearchMatch;
  readonly searchQuery?: string;
  readonly simultaneousSwipeGesture?: ComponentProps<typeof ThreadSwipeable>["simultaneousWith"];
}) {
  const { width: windowWidth } = useWindowDimensions();
  const {
    thread,
    variant,
    onSelectThread,
    onDeleteThread,
    onRegenerateThreadTitle,
    onRenameThread,
    onNewThreadOnBranch,
    onSettleThread,
    onSnoozeThread,
    onUnsnoozeThread,
    onStoreThread,
    onUnstoreThread,
    onUnsettleThread,
    onArchiveThread,
    onPinThread,
    onUnpinThread,
    onSetThreadAutoSettle,
    onMoveThread,
  } = props;
  const snoozedRow = props.snoozed === true;
  const storedRow = props.stored === true;
  const pinnedRow = props.pinned === true;
  const dormant = useSwipeRowDormant(props.activationKey);

  const { providerDrivers, providerIconUrl } = useMemo(() => {
    const provider = props.providers?.find(
      (candidate) =>
        candidate.instanceId ===
        (thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId),
    );
    return {
      providerDrivers: resolveThreadListV2ProviderDrivers(thread, props.providers),
      providerIconUrl: provider?.iconUrl,
    };
  }, [thread, props.providers]);

  const providerInstance = props.providerInstance;
  const pr = useThreadPr(thread);

  const { materialYouStyleLayoutActive, themeAppearance: colorScheme } = useAppearancePreferences();
  const theme = useUniwindTheme();
  const sidebarPane = props.pane === "sidebar";
  const selected = props.selected === true;
  const glass = use(ThreadListGlassContext) && !sidebarPane;
  // Shelf rows run together as one grouped card; active cards stand alone
  // and lead with a photo tile.
  const groupedRow = glass && variant === "slim";
  const glassCard = glass && variant === "card";
  const rowAppearance = getThreadListV2RowAppearance(
    theme,
    sidebarPane,
    selected,
    glass,
    groupedRow
      ? {
          joinsPrevious: props.continuesGroup === true,
          joinsNext: props.showTrailingDivider === true,
        }
      : undefined,
  );
  const subagentColor = selected
    ? String(
        theme[
          materialYouStyleLayoutActive
            ? "--color-thread-selected-foreground"
            : "--color-user-bubble-foreground"
        ] ?? "#0284c7",
      )
    : colorScheme === "dark"
      ? "#38bdf8"
      : "#0284c7";

  const status = resolveThreadListV2Status(thread);
  // "Done" also marks a completion the user has not opened yet — same emerald
  // label as the web sidebar, sourced from the server-side visited watermark
  // so checking a thread on any device clears it everywhere.
  const badge = resolveThreadListV2Badge(thread);
  const statusLabel = badge === null ? undefined : STATUS_BY_BADGE[badge];
  // The timestamp is precomputed on the list item (same stamps the settled
  // tail sorts by) so a minute tick only re-renders rows that draw it.
  const timeLabel = props.timeLabel;

  const handleDelete = useCallback(() => onDeleteThread(thread), [onDeleteThread, thread]);
  const handleRename = useCallback(() => onRenameThread(thread), [onRenameThread, thread]);
  const handleRegenerateTitle = useCallback(
    () => onRegenerateThreadTitle(thread),
    [onRegenerateThreadTitle, thread],
  );
  const handleSettle = useCallback(() => onSettleThread(thread), [onSettleThread, thread]);
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);
  // A recycled cell reassigns this mounted row to a different thread without
  // remounting it, and the render closure stops running while list equality
  // says the item is unchanged — so any row-local UI state must be dismissed
  // when the identity under it changes. Without this, a custom snooze sheet
  // opened for one thread survives the thread's removal/reorder and its
  // submit snoozes whichever thread the cell was reassigned to. (ThreadSwipeable
  // enforces the same contract on the swipe layer with its resetKey.)
  const rowIdentity = `${thread.environmentId}:${thread.id}`;
  const [boundIdentity, setBoundIdentity] = useState(rowIdentity);
  if (boundIdentity !== rowIdentity) {
    setBoundIdentity(rowIdentity);
    setCustomSnoozeOpen(false);
  }
  const handleSnooze = useCallback(
    (snoozedUntil: string) => onSnoozeThread(thread, snoozedUntil),
    [onSnoozeThread, thread],
  );
  const handleUnsnooze = useCallback(() => onUnsnoozeThread(thread), [onUnsnoozeThread, thread]);
  const handleStore = useCallback(() => onStoreThread(thread), [onStoreThread, thread]);
  const handleUnstore = useCallback(() => onUnstoreThread(thread), [onUnstoreThread, thread]);
  const handleUnsettle = useCallback(() => onUnsettleThread(thread), [onUnsettleThread, thread]);
  const handlePin = useCallback(() => onPinThread(thread), [onPinThread, thread]);
  const handleUnpin = useCallback(() => onUnpinThread(thread), [onUnpinThread, thread]);
  const handleSetAutoSettle = useCallback(
    (enabled: boolean) => onSetThreadAutoSettle(thread, enabled),
    [onSetThreadAutoSettle, thread],
  );
  const handleMoveUp = useCallback(() => onMoveThread?.(thread, "up"), [onMoveThread, thread]);
  const handleMoveDown = useCallback(() => onMoveThread?.(thread, "down"), [onMoveThread, thread]);
  const handleArchive = useCallback(() => onArchiveThread(thread), [onArchiveThread, thread]);

  // Swipe: the v2 primary action is the lifecycle transition. Un-settling a
  // settled row keeps it active until new activity clears the user override.
  const canUnsettle = variant === "slim" && !storedRow;
  const [snoozeGateTick, bumpSnoozeGateTick] = useState(0);
  const snoozeGateExpiryMs = props.snoozeSupported
    ? resolveThreadListV2SnoozeGateExpiryMs(thread, { now: new Date().toISOString() })
    : null;
  useEffect(() => {
    if (snoozeGateExpiryMs === null) return;
    const delayMs = Math.min(Math.max(0, snoozeGateExpiryMs - Date.now()) + 50, 2_147_483_647);
    const id = setTimeout(() => bumpSnoozeGateTick((tick) => tick + 1), delayMs);
    return () => clearTimeout(id);
  }, [snoozeGateExpiryMs, snoozeGateTick]);
  const swipeActions = resolveThreadListV2SwipeActions({
    variant,
    settlementSupported: props.settlementSupported,
    snoozeSupported: props.snoozeSupported,
    snoozable: canSnooze(thread, { now: new Date().toISOString() }),
    snoozed: snoozedRow,
    stored: storedRow,
  });
  const snoozePresets = useMemo(
    () => (swipeActions.secondary === "snooze" ? resolveSnoozePresets(new Date()) : ([] as const)),
    [props.snoozePresetMinute, swipeActions.secondary],
  );
  const snoozePresetActions = useMemo<MenuAction[]>(
    () => [
      ...snoozePresets.map((preset) => ({
        id: `snooze:${preset.id}`,
        title: preset.label,
        subtitle: preset.whenLabel,
      })),
      { id: "snooze:custom", title: "Custom…" },
    ],
    [snoozePresets],
  );
  // Pinned cards keep the full lifecycle menu; only the pin item flips to
  // Unpin. (Settling a pinned thread clears the pin server-side; snoozing
  // hides the card until wake with the pin intact.)
  const arrangementMenuItems = useMemo<MenuAction[]>(
    () => [
      ...(props.reorderSupported === true
        ? [
            { id: "arrange", title: "Arrange threads…", image: "line.3.horizontal" },
            {
              id: "move-up",
              title: "Move up",
              image: "arrow.up",
              attributes: { disabled: props.canMoveUp !== true },
            } satisfies MenuAction,
            {
              id: "move-down",
              title: "Move down",
              image: "arrow.down",
              attributes: { disabled: props.canMoveDown !== true },
            } satisfies MenuAction,
          ]
        : []),
      ...(props.pinningSupported
        ? [
            thread.pinnedAt != null
              ? { id: "unpin", title: "Unpin", image: "pin.slash" }
              : { id: "pin", title: "Pin", image: "pin" },
          ]
        : []),
    ],
    [
      props.canMoveDown,
      props.canMoveUp,
      props.reorderSupported,
      props.pinningSupported,
      thread.pinnedAt,
      variant,
    ],
  );
  // A submenu with the current option checked, matching web. This is a
  // per-thread setting, not a lifecycle verb.
  const autoSettleMenuItems = useMemo<MenuAction[]>(
    () =>
      props.autoSettleOptOutSupported
        ? [
            {
              id: "auto-settle",
              title: "Auto-settle behavior",
              image: "timer",
              subactions: [
                {
                  id: "auto-settle:enabled",
                  title: "Enabled",
                  state: thread.autoSettleDisabledAt == null ? "on" : "off",
                },
                {
                  id: "auto-settle:disabled",
                  title: "Disabled",
                  state: thread.autoSettleDisabledAt == null ? "off" : "on",
                },
              ],
            } satisfies MenuAction,
          ]
        : [],
    [props.autoSettleOptOutSupported, thread.autoSettleDisabledAt],
  );
  // Store sits in the menu, not the swipe slots: Settle and Snooze already
  // fill both. A stored thread working in Active offers Unstore instead.
  const storable = canStore(thread, { now: new Date().toISOString() });
  const storageMenuItems = useMemo<MenuAction[]>(
    () =>
      !props.storageSupported
        ? []
        : thread.storedAt != null
          ? [UNSTORE_MENU_ACTION]
          : storable
            ? [STORE_MENU_ACTION]
            : [],
    [props.storageSupported, storable, thread.storedAt],
  );
  const titleMenuItems = useMemo<MenuAction[]>(
    () => [
      { id: "rename", title: "Rename", image: "square.and.pencil" },
      ...buildThreadTitleRegenerationMenuItems({
        supported: props.titleRegenerationSupported,
        isRegenerating: thread.titleRegeneration != null,
      }),
    ],
    [props.titleRegenerationSupported, thread.titleRegeneration],
  );
  const snoozableCardMenuActions = useMemo<MenuAction[]>(
    () => [
      { id: "settle", title: "Settle", image: "checkmark" },
      {
        id: "snooze",
        title: "Snooze",
        image: "clock",
        subactions: snoozePresetActions,
      },
      ...storageMenuItems,
      ...arrangementMenuItems,
      ...titleMenuItems,
      ...autoSettleMenuItems,
      { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
    ],
    [
      arrangementMenuItems,
      autoSettleMenuItems,
      snoozePresetActions,
      storageMenuItems,
      titleMenuItems,
    ],
  );
  const cardMenuActions = useMemo<MenuAction[]>(
    () => [
      CARD_MENU_ACTIONS[0]!,
      ...storageMenuItems,
      ...arrangementMenuItems,
      ...titleMenuItems,
      ...autoSettleMenuItems,
      ...CARD_MENU_ACTIONS.slice(1),
    ],
    [arrangementMenuItems, autoSettleMenuItems, storageMenuItems, titleMenuItems],
  );
  // Settled and snoozed rows keep the setting too, matching web where every
  // row shares one menu builder.
  const slimMenuActions = useMemo<MenuAction[]>(
    () => [
      SLIM_MENU_ACTIONS[0]!,
      ...storageMenuItems,
      ...arrangementMenuItems.filter(
        (action) => action.id !== "move-up" && action.id !== "move-down",
      ),
      ...titleMenuItems,
      ...autoSettleMenuItems,
      SLIM_MENU_ACTIONS[1]!,
    ],
    [arrangementMenuItems, autoSettleMenuItems, storageMenuItems, titleMenuItems],
  );
  // Storing a snoozed thread ends the snooze cycle for good.
  const snoozedMenuActions = useMemo<MenuAction[]>(
    () => [
      SNOOZED_MENU_ACTIONS[0]!,
      ...storageMenuItems,
      ...titleMenuItems,
      ...autoSettleMenuItems,
      SNOOZED_MENU_ACTIONS[1]!,
    ],
    [autoSettleMenuItems, storageMenuItems, titleMenuItems],
  );
  // Settle un-stores server-side, so a finished long-term thread needs one step.
  const storedMenuActions = useMemo<MenuAction[]>(
    () => [
      UNSTORE_MENU_ACTION,
      ...(props.settlementSupported ? [CARD_MENU_ACTIONS[0]!] : []),
      ...titleMenuItems,
      SNOOZED_MENU_ACTIONS[1]!,
    ],
    [props.settlementSupported, titleMenuItems],
  );
  const legacyMenuActions = useMemo<MenuAction[]>(
    () => [
      LEGACY_MENU_ACTIONS[0]!,
      ...arrangementMenuItems,
      ...titleMenuItems,
      LEGACY_MENU_ACTIONS[1]!,
    ],
    [arrangementMenuItems, titleMenuItems],
  );
  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "new-thread-on-branch") onNewThreadOnBranch(thread);
      if (nativeEvent.event === "settle") handleSettle();
      if (nativeEvent.event === "unsettle") handleUnsettle();
      if (nativeEvent.event === "unsnooze") handleUnsnooze();
      if (nativeEvent.event === "store") handleStore();
      if (nativeEvent.event === "unstore") handleUnstore();
      if (nativeEvent.event === "pin") handlePin();
      if (nativeEvent.event === "unpin") handleUnpin();
      if (nativeEvent.event === "auto-settle:enabled") handleSetAutoSettle(true);
      if (nativeEvent.event === "auto-settle:disabled") handleSetAutoSettle(false);
      if (nativeEvent.event === "arrange") appAtomRegistry.set(threadArrangementOpenAtom, true);
      if (nativeEvent.event === "move-up") handleMoveUp();
      if (nativeEvent.event === "move-down") handleMoveDown();
      if (nativeEvent.event === "archive") handleArchive();
      if (nativeEvent.event === "rename") handleRename();
      if (nativeEvent.event === "regenerate-title") handleRegenerateTitle();
      if (nativeEvent.event === "copy-thread-id") {
        copyTextWithHaptic(thread.id, { target: "thread-id" });
      }
      if (nativeEvent.event === "delete") handleDelete();
      if (nativeEvent.event === "snooze:custom") {
        setCustomSnoozeOpen(true);
        return;
      }
      const snoozeSelection = resolveThreadListV2SnoozeMenuSelection({
        event: nativeEvent.event,
        displayedPresets: snoozePresets,
        now: new Date(),
      });
      if (snoozeSelection._tag === "selected") {
        handleSnooze(snoozeSelection.preset.snoozedUntil);
      } else if (snoozeSelection._tag === "expired") {
        Alert.alert("Could not snooze thread", "That snooze time has passed. Choose another time.");
      }
    },
    [
      onNewThreadOnBranch,
      thread,
      handleArchive,
      handleDelete,
      handleRegenerateTitle,
      handleRename,
      handleMoveDown,
      handleMoveUp,
      handlePin,
      handleSettle,
      handleSnooze,
      handleSetAutoSettle,
      handleStore,
      handleUnpin,
      handleUnsettle,
      handleUnsnooze,
      setCustomSnoozeOpen,
      snoozePresets,
    ],
  );
  const primaryAction = useMemo(() => {
    // Pre-settlement server: archive is the swipe action, as in v1. (Slim
    // rows cannot occur here — unsupported environments never classify as
    // settled.)
    if (swipeActions.primary === "archive") {
      return {
        accessibilityLabel: `Archive ${thread.title}`,
        icon: "archivebox" as const,
        label: "Archive",
        onPress: handleArchive,
      };
    }
    if (swipeActions.primary === "unstore") {
      return {
        accessibilityLabel: `Unstore ${thread.title}`,
        icon: "tray.and.arrow.up" as const,
        label: "Unstore",
        onPress: handleUnstore,
      };
    }
    if (swipeActions.primary === "unsnooze") {
      return {
        accessibilityLabel: `Wake ${thread.title} now`,
        icon: "clock" as const,
        label: "Wake",
        onPress: handleUnsnooze,
      };
    }
    return swipeActions.primary === "unsettle"
      ? {
          accessibilityLabel: `Un-settle ${thread.title}`,
          icon: "arrow.uturn.backward" as const,
          label: "Un-settle",
          onPress: handleUnsettle,
        }
      : {
          accessibilityLabel: `Settle ${thread.title}`,
          icon: "checkmark" as const,
          label: "Settle",
          onPress: handleSettle,
        };
  }, [
    handleArchive,
    handleSettle,
    handleUnsettle,
    handleUnsnooze,
    handleUnstore,
    swipeActions.primary,
    thread.title,
  ]);
  const secondaryAction = useMemo(
    () =>
      swipeActions.secondary === "snooze"
        ? {
            accessibilityLabel: `Choose when to snooze ${thread.title}`,
            icon: "clock" as const,
            label: "Snooze",
            menu: {
              actions: snoozePresetActions,
              onPressAction: handleMenuAction,
              title: "Snooze until",
            },
            onPress: () => undefined,
          }
        : null,
    [handleMenuAction, snoozePresetActions, swipeActions.secondary, thread.title],
  );
  const swipeAccessibilityHint =
    secondaryAction === null
      ? `Opens the thread. Swipe left to ${primaryAction.label.toLowerCase()}.`
      : `Opens the thread. Swipe left for ${primaryAction.label.toLowerCase()} and snooze actions.`;

  // Sidebar rows use navigation foregrounds on their active and idle surfaces.
  // The sidebar pane fills selected rows with the theme's message surface, so selected text
  // uses that surface's paired foreground.
  const nestToggle =
    props.nest === "parent" && (props.childCount ?? 0) > 0 ? (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.nestExpanded !== false }}
        accessibilityLabel={
          props.nestExpanded === false ? "Show related threads" : "Hide related threads"
        }
        hitSlop={8}
        onPress={() => {
          if (props.pullRequestKey) props.onToggleNest?.(props.pullRequestKey);
        }}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      >
        <SymbolView
          name={props.nestExpanded === false ? "chevron.right" : "chevron.down"}
          size={14}
          tintColorClassName="accent-foreground-muted"
          type="monochrome"
          weight="medium"
        />
      </Pressable>
    ) : null;
  const collapsedNestMeta =
    props.nest === "parent" && props.nestExpanded === false && (props.childCount ?? 0) > 0 ? (
      <>
        <Text className="text-xs tabular-nums text-foreground-tertiary">+{props.childCount}</Text>
        {props.collapsedNestStatus ? (
          <Text className="text-xs font-t3-medium text-foreground-secondary" numberOfLines={1}>
            {props.collapsedNestStatus.label}
          </Text>
        ) : null}
      </>
    ) : null;
  const cardContent = (
    <>
      <View className={cn("flex-row items-center gap-1.5", glassCard && "min-h-6")}>
        {nestToggle}
        {collapsedNestMeta}
        {props.project && !glassCard ? (
          <ProjectFavicon
            environmentId={thread.environmentId}
            faviconPath={props.project.faviconPath}
            projectIcon={props.project.projectIcon}
            size={15}
            projectTitle={props.project.title}
            workspaceRoot={props.project.workspaceRoot}
          />
        ) : null}
        <Text
          className={cn(
            "flex-1 text-sm font-t3-medium",
            selected
              ? selectedThreadRowColors.mutedForegroundClassName
              : rowAppearance.mutedForegroundClassName,
          )}
          numberOfLines={1}
        >
          {props.projectTitle ?? props.project?.title ?? ""}
        </Text>
        {props.hasQueuedMessages ? <QueuedMessageIcon selected={selected} /> : null}
        {pinnedRow ? (
          <SymbolView
            name="pin"
            size={11}
            tintColorClassName={rowAppearance.mutedIconTintClassName}
            type="monochrome"
          />
        ) : null}
        {/* A stored thread only shows here while it works or waits on the
            user; the glyph says it returns to the Stored shelf afterwards. */}
        {props.storageSupported && thread.storedAt != null ? (
          <SymbolView
            accessibilityLabel="Stored"
            name="tray.full"
            size={11}
            tintColorClassName={rowAppearance.mutedIconTintClassName}
            type="monochrome"
          />
        ) : null}
        <RowStatusFade identity={rowIdentity} status={statusLabel?.label ?? null}>
          {glassCard && statusLabel ? (
            <StatusPill label={statusLabel.label} size="compact" {...statusLabel.pill} />
          ) : (
            <Text
              className={cn(
                "text-xs tabular-nums",
                statusLabel?.className ??
                  (selected
                    ? selectedThreadRowColors.foregroundClassName
                    : rowAppearance.tertiaryForegroundClassName),
              )}
            >
              {statusLabel?.label ?? timeLabel}
            </Text>
          )}
        </RowStatusFade>
      </View>
      <View className="mt-1 flex-row items-center gap-1">
        <ThreadActiveSubagentCount color={subagentColor} count={thread.activeSubagentCount} />
        <Text
          className={cn(
            "flex-1 text-base font-t3-medium",
            selected
              ? selectedThreadRowColors.foregroundClassName
              : rowAppearance.foregroundClassName,
          )}
          numberOfLines={2}
        >
          {thread.title}
        </Text>
      </View>
      {props.searchMatch ? (
        <View className="mt-1">
          <ThreadSearchMatchExcerpt
            sidebar={sidebarPane}
            match={props.searchMatch}
            query={props.searchQuery ?? ""}
            selected={selected}
          />
        </View>
      ) : null}
      <View className="mt-1 flex-row items-center gap-2">
        {(status === "failed" || status === "limited") && thread.runtime?.lastError ? (
          <Text
            className={cn(
              "flex-1 text-xs",
              selected
                ? selectedThreadRowColors.mutedForegroundClassName
                : status === "limited"
                  ? "text-warning-foreground"
                  : "text-danger-foreground",
            )}
            numberOfLines={1}
          >
            {thread.runtime.lastError}
          </Text>
        ) : thread.branch || props.environmentLabel ? (
          /* "branch · machine" share one truncating line. The machine sits
             last so a tight fit cuts the repetitive label, not the branch —
             and machine-only fills the row for non-git projects. The glyph
             hugs the label (it cannot live inside the Text without breaking
             truncation), and the wrapper takes the slack so the trailers
             stay pinned right. */
          <View className="min-w-0 flex-1 flex-row items-center gap-1">
            {glassCard && thread.branch ? (
              <SymbolView
                name="arrow.triangle.branch"
                size={11}
                tintColorClassName={rowAppearance.mutedIconTintClassName}
                type="monochrome"
              />
            ) : null}
            <Text
              className={cn(
                "shrink text-xs",
                selected
                  ? selectedThreadRowColors.mutedForegroundClassName
                  : rowAppearance.mutedForegroundClassName,
              )}
              numberOfLines={1}
            >
              {thread.branch ? (
                <Text
                  className={cn(
                    "text-xs",
                    selected
                      ? selectedThreadRowColors.mutedForegroundClassName
                      : rowAppearance.mutedForegroundClassName,
                  )}
                  style={{ fontFamily: MONO_FONT }}
                >
                  {thread.branch}
                </Text>
              ) : null}
              {thread.branch && props.environmentLabel ? "  ·  " : null}
              {props.environmentLabel ? (
                <Text
                  className={cn(
                    "text-xs",
                    selected
                      ? selectedThreadRowColors.mutedForegroundClassName
                      : rowAppearance.tertiaryForegroundClassName,
                  )}
                >
                  {props.environmentLabel}
                </Text>
              ) : null}
            </Text>
            {props.environmentLabel && props.environmentMachine ? (
              <EnvironmentMachineSymbol
                kind={props.environmentMachine}
                size={11}
                tintColorClassName={
                  selected
                    ? selectedThreadRowColors.mutedIconTintClassName
                    : rowAppearance.tertiaryIconTintClassName
                }
              />
            ) : null}
          </View>
        ) : (
          <View className="flex-1" />
        )}
        {pr ? (
          <View className="flex-row items-center gap-1" accessibilityLabel={pr.accessibilityLabel}>
            <SymbolView
              name={pr.kind === "stack" ? "square.3.layers.3d" : "arrow.triangle.pull"}
              size={12}
              tintColorClassName={
                pr.state === null || pr.isDraft
                  ? rowAppearance.mutedIconTintClassName
                  : pr.state === "open"
                    ? "accent-adaptive-emerald-600-400"
                    : pr.state === "closed"
                      ? "accent-adaptive-rose-600-400"
                      : "accent-adaptive-violet-600-400"
              }
            />
            <Text
              accessibilityLabel={pr.accessibilityLabel}
              className={cn("text-xs", pr.textClassName)}
              style={{ fontFamily: MONO_FONT }}
            >
              {pr.label}
            </Text>
          </View>
        ) : null}
        {providerInstance ? (
          // Earlier owners peek out behind the current provider so a
          // handed-off thread shows where it has been. The current owner
          // keeps its account badge so same-driver instances stay distinct.
          <View className="flex-row items-center">
            {providerDrivers.slice(0, -1).map((driver, index) => (
              <View key={`${driver}:${index}`} className="-mr-1 opacity-30">
                <ProviderIcon provider={driver} size={12} />
              </View>
            ))}
            <ProviderInstanceIcon
              iconUrl={providerIconUrl}
              provider={providerInstance.driverKind}
              size={14}
              displayName={providerInstance.displayName}
              accentColor={providerInstance.accentColor}
              showBadge={providerInstance.showBadge}
              surfaceColor={rowAppearance.providerIconSurfaceColor}
            />
          </View>
        ) : null}
      </View>
    </>
  );

  const rowAccessibilityLabel = [
    thread.title,
    (thread.activeSubagentCount ?? 0) > 0
      ? `${thread.activeSubagentCount} ${thread.activeSubagentCount === 1 ? "subagent" : "subagents"} working`
      : null,
    props.hasQueuedMessages ? "messages queued to send" : null,
  ]
    .filter(Boolean)
    .join(", ");

  const rowContent = (close: () => void) =>
    variant === "card" ? (
      <RowPressable
        key={`${thread.environmentId}:${thread.id}`}
        interactionClassName={rowAppearance.interactionClassName}
        interactionOpacity={rowAppearance.interactionOpacity}
        className={rowAppearance.className}
        accessibilityHint={swipeAccessibilityHint}
        accessibilityLabel={rowAccessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => {
          close();
          onSelectThread(thread);
        }}
        style={rowAppearance.cardStyle}
      >
        {sidebarPane ? (
          <View style={props.nest === "child" ? { paddingLeft: 16 } : undefined}>
            {cardContent}
          </View>
        ) : (
          /* Flat native list rows: no tonal containers — colored status
             labels and text hierarchy carry state, an inset hairline
             separates rows. The opaque screen background stays so swipe
             actions reveal behind the row. */
          <View>
            {glassCard ? (
              <View
                className="flex-row items-start gap-3 px-4 py-3"
                style={props.nest === "child" ? { paddingLeft: 36 } : undefined}
              >
                <ThreadCardTile
                  environmentId={thread.environmentId}
                  photoURL={props.sceneryThumbURL ?? null}
                  project={props.project}
                />
                <View className="min-w-0 flex-1">{cardContent}</View>
              </View>
            ) : (
              <View
                className={THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME}
                style={props.nest === "child" ? { paddingLeft: 36 } : undefined}
              >
                {cardContent}
              </View>
            )}
            {THREAD_LIST_V2_ROW_DIVIDERS && !glass && props.showTrailingDivider !== false ? (
              <View className="ml-5 h-px bg-border-subtle" />
            ) : null}
          </View>
        )}
      </RowPressable>
    ) : (
      <RowPressable
        key={`${thread.environmentId}:${thread.id}`}
        interactionClassName={rowAppearance.interactionClassName}
        interactionOpacity={rowAppearance.interactionOpacity}
        accessibilityHint={swipeAccessibilityHint}
        accessibilityLabel={rowAccessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        className={rowAppearance.className}
        onPress={() => {
          close();
          onSelectThread(thread);
        }}
        style={rowAppearance.style}
      >
        {/* Settled history recedes: dimmed favicon + muted title. */}
        <View
          className={cn(
            "min-h-[44px] flex-row items-center gap-2.5 py-2",
            sidebarPane ? "px-3" : glass ? "px-4" : "px-5",
          )}
          style={props.nest === "child" ? { paddingLeft: sidebarPane ? 28 : 36 } : undefined}
        >
          {nestToggle}
          {collapsedNestMeta}
          {props.project ? (
            <View className="opacity-40">
              <ProjectFavicon
                environmentId={thread.environmentId}
                faviconPath={props.project.faviconPath}
                projectIcon={props.project.projectIcon}
                size={15}
                projectTitle={props.project.title}
                workspaceRoot={props.project.workspaceRoot}
              />
            </View>
          ) : null}
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-1">
              <ThreadActiveSubagentCount color={subagentColor} count={thread.activeSubagentCount} />
              <Text
                className={cn(
                  "min-w-0 flex-1 text-base",
                  selected
                    ? selectedThreadRowColors.foregroundClassName
                    : rowAppearance.mutedForegroundClassName,
                )}
                numberOfLines={1}
              >
                {thread.title}
              </Text>
            </View>
            {props.searchMatch ? (
              <ThreadSearchMatchExcerpt
                sidebar={sidebarPane}
                match={props.searchMatch}
                query={props.searchQuery ?? ""}
                selected={selected}
              />
            ) : null}
          </View>
          {props.hasQueuedMessages ? <QueuedMessageIcon selected={selected} /> : null}
          <Text
            className={cn(
              "text-sm tabular-nums",
              selected
                ? selectedThreadRowColors.mutedForegroundClassName
                : snoozedRow
                  ? rowAppearance.mutedForegroundClassName
                  : rowAppearance.tertiaryForegroundClassName,
            )}
            style={{ fontFamily: MONO_FONT }}
          >
            {snoozedRow && props.snoozeWakeLabelText !== undefined
              ? props.snoozeWakeLabelText
              : timeLabel}
          </Text>
        </View>
        {groupedRow && props.continuesGroup === true ? (
          // Inset like a grouped table: the rule starts where the title does.
          <View
            pointerEvents="none"
            className="absolute right-0 top-0 bg-chrome-glass-border"
            style={{
              height: StyleSheet.hairlineWidth,
              left: props.nest === "child" ? 36 : props.project ? 41 : 16,
            }}
          />
        ) : null}
      </RowPressable>
    );

  return (
    <RowArrival
      identity={rowIdentity}
      snoozed={snoozedRow}
      settled={variant === "slim" && !snoozedRow && !storedRow}
    >
      {customSnoozeOpen && (
        <CustomSnoozeSheet onClose={() => setCustomSnoozeOpen(false)} onSnooze={handleSnooze} />
      )}
      <ThreadSwipeable
        dormant={dormant}
        threadKey={`${thread.environmentId}:${thread.id}`}
        backgroundColor={rowAppearance.swipeBackgroundColor}
        actionsBackgroundColor={rowAppearance.swipeActionsBackgroundColor}
        compactActions={variant === "slim"}
        containerStyle={rowAppearance.swipeContainerStyle}
        outlineStyle={rowAppearance.outlineStyle}
        enableTrackpadSwipe
        // Full swipe commits the advertised lifecycle action (Settle /
        // Un-settle), never the secondary snooze action.
        fullSwipeAction="primary"
        fullSwipeWidth={props.fullSwipeWidth ?? windowWidth - 32}
        onDelete={handleDelete}
        onSwipeableClose={props.onSwipeableClose}
        onSwipeableWillOpen={props.onSwipeableWillOpen}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        resetKey={`${thread.environmentId}:${thread.id}:${variant}:${snoozedRow}:${storedRow}:${thread.settledAt}:${thread.unsettledAt}:${thread.snoozedUntil}:${thread.storedAt}`}
        simultaneousWith={props.simultaneousSwipeGesture}
        threadTitle={thread.title}
      >
        {(close) => (
          <ControlPillMenu
            actions={[
              ...(thread.branch
                ? [
                    {
                      id: "new-thread-on-branch",
                      title: getThreadListV2NewBranchMenuTitle(thread.branch),
                      image: "square.and.pencil",
                    },
                  ]
                : []),
              { id: "copy-thread-id", title: "Copy thread ID", image: "doc.on.doc" },
              ...(storedRow
                ? storedMenuActions
                : snoozedRow
                  ? snoozedMenuActions
                  : !props.settlementSupported
                    ? legacyMenuActions
                    : canUnsettle
                      ? slimMenuActions
                      : swipeActions.secondary === "snooze"
                        ? snoozableCardMenuActions
                        : cardMenuActions),
            ]}
            onPressAction={handleMenuAction}
            shouldOpenOnLongPress
          >
            {rowContent(close)}
          </ControlPillMenu>
        )}
      </ThreadSwipeable>
    </RowArrival>
  );
});

/**
 * Fades a row in where a settle or snooze landed it (or back in place when
 * the command failed). Driven by the departure marker, never by mounting:
 * recycled cells mount without it, so scrolling never replays the fade.
 */
function RowArrival(props: {
  readonly identity: string;
  readonly snoozed: boolean;
  readonly settled: boolean;
  readonly children: ReactNode;
}) {
  const { identity } = props;
  const subscribe = useCallback(
    (listener: () => void) => subscribeThreadDeparture(identity, listener),
    [identity],
  );
  const departure = useSyncExternalStore(subscribe, () => getThreadDepartureSnapshot(identity));
  const landed = threadDepartureHasLanded(departure.departingKind, {
    snoozed: props.snoozed,
    settled: props.settled,
  });
  useEffect(() => {
    if (landed) clearThreadDeparting(identity);
  }, [identity, landed]);
  const progress = useSharedValue(departure.arriving ? 0 : 1);
  useLayoutEffect(() => {
    // A cell recycled mid-fade must not hand its opacity to the next thread.
    if (!departure.arriving) {
      progress.set(1);
      return;
    }
    progress.set(0);
    progress.set(withTiming(1, MOTION_TIMING));
  }, [departure.arriving, identity, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 6 }],
  }));
  return (
    <Animated.View collapsable={false} style={style}>
      {props.children}
    </Animated.View>
  );
}

/**
 * Cross-fades the status slot when a thread changes state (Working → Done).
 * Keyed on the thread so a recycled cell taking a new thread never fades,
 * and on the status kind so minute ticks of the timestamp never fade.
 */
function RowStatusFade(props: {
  readonly identity: string;
  readonly status: string | null;
  readonly children: ReactNode;
}) {
  const opacity = useSharedValue(1);
  const previous = useRef({ identity: props.identity, status: props.status });
  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { identity: props.identity, status: props.status };
    if (last.identity !== props.identity || last.status === props.status) return;
    opacity.set(0);
    opacity.set(withTiming(1, MOTION_TIMING));
  }, [opacity, props.identity, props.status]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={style}>{props.children}</Animated.View>;
}
