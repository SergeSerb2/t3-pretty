import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import {
  canSnooze,
  resolveSnoozePresets,
  type ChangeRequestSettleSource,
} from "@t3tools/client-runtime/state/thread-settled";
import type { MenuAction } from "@react-native-menu/menu";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { Alert, Platform, Pressable, useWindowDimensions, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPill";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { ProviderIcon } from "../../components/ProviderIcon";
import { cn } from "../../lib/cn";
import { HOME_HORIZONTAL_INSET } from "../../lib/layoutMetrics";
import { relativeTime } from "../../lib/time";
import { useThemeColor } from "../../lib/useThemeColor";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { useThreadPr } from "../../state/use-thread-pr";
import {
  clearThreadDeparting,
  getThreadDepartureSnapshot,
  subscribeThreadDeparture,
} from "../home/thread-departure-store";
import { ThreadSwipeable } from "../home/thread-swipe-actions";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { buildThreadTitleRegenerationMenuItems } from "./thread-title-regeneration-menu";
import { THREAD_RENAME_MENU_ACTION } from "./thread-rename";
import {
  resolveThreadListV2SnoozeMenuSelection,
  resolveThreadListV2SnoozeGateExpiryMs,
  resolveThreadListV2Status,
  resolveThreadListV2SwipeActions,
  type ThreadListV2Status,
} from "./threadListV2";
import { threadListV2CardPlateStyle } from "./threadListV2Chrome";
import { ThreadSearchMatchExcerpt } from "./thread-search-match";

/**
 * Thread List v2 renders one flat native list: rich rows for active work and
 * a receded settled tail, all with native swipe and long-press actions.
 * Over World Scenery the opaque screen plates lift: active work sits on
 * frosted cards, snoozed/settled history uses the same card language at a
 * quieter density under typographic section labels, and the wash — not
 * per-row blur or native glass — carries text contrast.
 */

const MONO_FONT = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

// Status hues follow the system-wide convention set by sidebar v1 and the
// Live Activity/widgets (amber approval, indigo input, sky working) so a
// thread reads the same color everywhere it surfaces.
const STATUS_LABEL_BY_STATUS: Partial<
  Record<ThreadListV2Status, { label: string; className: string }>
> = {
  approval: { label: "Approval", className: "text-amber-700 dark:text-amber-300" },
  input: { label: "Input", className: "text-indigo-600 dark:text-indigo-300" },
  working: { label: "Working", className: "text-sky-600 dark:text-sky-400" },
  monitoring: { label: "Monitoring", className: "text-sky-600 dark:text-sky-400" },
  failed: { label: "Failed", className: "text-red-700 dark:text-red-300" },
};

function threadTimeLabel(thread: EnvironmentThreadShell): string {
  return relativeTime(thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt);
}

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

// Pre-settlement servers: no lifecycle items, archive fills the gap.
const LEGACY_MENU_ACTIONS: MenuAction[] = [
  { id: "archive", title: "Archive", image: "archivebox" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

/** Rounded-row radius shared with the v1 sidebar rows. */
const SIDEBAR_V2_ROW_RADIUS = 12;

// Settle/snooze departure, ported from web's sidebar-row-depart/arrive
// keyframes: the row slides out the moment the action fires, then the same
// row (FlatList keeps its key across the shelf move) fades back in at its
// destination — or in place when the command failed.
const DEPART_DURATION_MS = 240;
const ARRIVE_DURATION_MS = 200;

/**
 * Drives the optimistic settle/snooze exit and the arrive fade for one row.
 * `landed` is the canonical classification signal: once the row renders on
 * the shelf its departure targeted, the exit hands off to the arrive fade.
 */
function useThreadDepartureAnimation(threadKey: string, landed: boolean) {
  const snapshot = useSyncExternalStore(subscribeThreadDeparture, () =>
    getThreadDepartureSnapshot(threadKey),
  );
  const departing = snapshot.departingKind !== null;
  const arriving = snapshot.arriving;

  useEffect(() => {
    if (departing && landed) clearThreadDeparting(threadKey);
  }, [departing, landed, threadKey]);

  const opacity = useSharedValue(1);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (departing && landed) return; // the clear above re-runs this as arriving
    if (departing) {
      const config = {
        duration: DEPART_DURATION_MS,
        easing: Easing.bezier(0.3, 0, 0.8, 0.15),
        reduceMotion: ReduceMotion.System,
      };
      opacity.value = withTiming(0, config);
      translateY.value = withTiming(12, config);
      scale.value = withTiming(0.98, config);
      return;
    }
    if (arriving) {
      opacity.value = 0;
      translateY.value = 6;
      scale.value = 1;
      const config = {
        duration: ARRIVE_DURATION_MS,
        easing: Easing.bezier(0.05, 0.7, 0.1, 1),
        reduceMotion: ReduceMotion.System,
      };
      opacity.value = withTiming(1, config);
      translateY.value = withTiming(0, config);
      return;
    }
    opacity.value = 1;
    translateY.value = 0;
    scale.value = 1;
  }, [arriving, departing, landed, opacity, scale, translateY]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return { style, departing };
}

/** Section label + rule: the only structure in an otherwise flat list. */
export const ThreadListV2SectionDivider = memo(function ThreadListV2SectionDivider(props: {
  readonly label: string;
  readonly pane?: "screen" | "sidebar";
}) {
  const borderColor = useThemeColor("--color-border");
  return (
    <View
      className={cn(
        "mb-1.5 mt-4 flex-row items-center gap-2.5",
        props.pane === "sidebar" ? "px-3" : "px-5",
      )}
    >
      <Text className="text-xs font-t3-medium text-foreground-tertiary">{props.label}</Text>
      <View className="h-px flex-1" style={{ backgroundColor: borderColor }} />
    </View>
  );
});

const SNOOZE_ACCENT_LIGHT = "#2563eb";
const SNOOZE_ACCENT_DARK = "#60a5fa";

/**
 * Quiet section label for parked work. Not a plate: the inbox cards already
 * carry the surface, and a filled pill here reads as a second primary action.
 * Count stays visible while expanded so the shelf never hides its size.
 */
const ThreadListV2ShelfHeader = memo(function ThreadListV2ShelfHeader(props: {
  readonly kind: "snoozed" | "settled";
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly pane?: "screen" | "sidebar";
  readonly sceneryChrome?: boolean;
}) {
  const { themeAppearance: colorScheme } = useAppearancePreferences();
  const mutedColor = useThemeColor("--color-foreground-muted");
  const tertiaryColor = useThemeColor("--color-foreground-tertiary");
  const snoozed = props.kind === "snoozed";
  const sceneryChrome = props.sceneryChrome === true;
  const sidebarPane = props.pane === "sidebar";
  const snoozeTint = colorScheme === "dark" ? SNOOZE_ACCENT_DARK : SNOOZE_ACCENT_LIGHT;
  const iconTint = snoozed ? snoozeTint : tertiaryColor;
  const chevronTint = snoozed ? snoozeTint : mutedColor;
  const label = snoozed ? "Snoozed" : "Settled";
  const noun = snoozed ? "snoozed" : "settled";
  return (
    <Pressable
      accessibilityHint={
        props.expanded ? `Collapses the ${noun} threads.` : `Expands the ${noun} threads.`
      }
      accessibilityLabel={props.count === 1 ? `1 ${noun} thread` : `${props.count} ${noun} threads`}
      accessibilityRole="button"
      accessibilityState={{ expanded: props.expanded }}
      className="w-full"
      onPress={props.onToggle}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        className={cn(
          "min-h-[44px] flex-row items-center gap-2",
          sidebarPane ? "mt-2 px-3" : sceneryChrome ? "mt-1" : "mb-1.5 mt-4 px-5",
        )}
        style={
          sceneryChrome && !sidebarPane
            ? { paddingHorizontal: HOME_HORIZONTAL_INSET + 16 }
            : undefined
        }
      >
        <SymbolView
          name={snoozed ? "clock" : "checkmark.circle"}
          size={13}
          tintColor={iconTint}
          type="monochrome"
        />
        <Text
          className={cn(
            "text-xs font-t3-medium",
            snoozed ? "text-foreground-muted" : "text-foreground-tertiary",
          )}
        >
          {label}
        </Text>
        <View className="flex-1" />
        <Text
          className={cn(
            "text-xs font-t3-medium tabular-nums",
            snoozed ? "text-blue-600 dark:text-blue-400" : "text-foreground-tertiary",
          )}
        >
          {props.count}
        </Text>
        <SymbolView
          name={props.expanded ? "chevron.up" : "chevron.down"}
          size={10}
          tintColor={chevronTint}
          type="monochrome"
        />
      </View>
    </Pressable>
  );
});

export const ThreadListV2SnoozedShelfHeader = memo(function ThreadListV2SnoozedShelfHeader(props: {
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly pane?: "screen" | "sidebar";
  readonly sceneryChrome?: boolean;
}) {
  return <ThreadListV2ShelfHeader {...props} kind="snoozed" />;
});

export const ThreadListV2SettledShelfHeader = memo(function ThreadListV2SettledShelfHeader(props: {
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly pane?: "screen" | "sidebar";
  readonly sceneryChrome?: boolean;
}) {
  return <ThreadListV2ShelfHeader {...props} kind="settled" />;
});

const PENDING_TASK_MENU_ACTIONS: MenuAction[] = [
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

/**
 * A queued new task, in the same idiom as an active v2 row: it is work the
 * user wrote, so it reads like the threads it will become. "Queued" takes
 * the status slot — the state is the one thing that differs — and stays
 * uncolored because nothing is asked of the user; the environment is simply
 * not reachable yet.
 */
export const ThreadListV2PendingRow = memo(function ThreadListV2PendingRow(props: {
  readonly pendingTask: PendingNewTask;
  readonly project: EnvironmentProject | null;
  readonly projectTitle?: string;
  readonly environmentLabel: string | null;
  readonly pane?: "screen" | "sidebar";
  /** Draws the "Pending" divider above the first queued row. */
  readonly showPendingDivider: boolean;
  /** Keeps row hairlines inside a section; section headers draw their own rule. */
  readonly showTrailingDivider?: boolean;
  /** Translucent chrome over World Scenery; ignored in the sidebar pane. */
  readonly sceneryChrome?: boolean;
  readonly onSelectPendingTask: (pendingTask: PendingNewTask) => void;
  readonly onDeletePendingTask: (pendingTask: PendingNewTask) => void;
}) {
  const { pendingTask, onSelectPendingTask, onDeletePendingTask } = props;
  const drawerColor = useThemeColor("--color-drawer");
  const pressedBackgroundColor = useThemeColor("--color-subtle");
  const chromeFill = useThemeColor("--color-chrome-glass");
  const chromeBorder = useThemeColor("--color-chrome-glass-border");
  const sidebarPane = props.pane === "sidebar";
  const sceneryChrome = props.sceneryChrome === true && !sidebarPane;
  const projectTitle =
    props.projectTitle ?? props.project?.title ?? pendingTask.creation.projectTitle ?? "";
  const branch = pendingTask.creation.branch;

  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "delete") onDeletePendingTask(pendingTask);
    },
    [onDeletePendingTask, pendingTask],
  );

  const rowContent = (
    <>
      <View className="flex-row items-center gap-1.5">
        {props.project ? (
          <ProjectFavicon
            environmentId={pendingTask.message.environmentId}
            faviconPath={props.project.faviconPath}
            size={15}
            projectTitle={projectTitle}
            workspaceRoot={props.project.workspaceRoot}
          />
        ) : null}
        <Text className="flex-1 text-sm font-t3-medium text-foreground-muted" numberOfLines={1}>
          {projectTitle}
        </Text>
        <Text className="text-xs text-foreground-tertiary">Queued</Text>
      </View>
      {/* One line, unlike the two an active row allows: a queued title is
          derived from the whole prompt rather than written as a title, so the
          second line is usually a stray word or emoji rather than meaning. */}
      <Text className="mt-1 text-base font-t3-medium text-foreground" numberOfLines={1}>
        {pendingTask.title}
      </Text>
      {branch || props.environmentLabel ? (
        <Text className="mt-1 text-xs text-foreground-muted" numberOfLines={1}>
          {branch ? (
            <Text className="text-xs text-foreground-muted" style={{ fontFamily: MONO_FONT }}>
              {branch}
            </Text>
          ) : null}
          {branch && props.environmentLabel ? "  ·  " : null}
          {props.environmentLabel ? (
            <Text className="text-xs text-foreground-tertiary">{props.environmentLabel}</Text>
          ) : null}
        </Text>
      ) : null}
    </>
  );

  return (
    <>
      {props.showPendingDivider ? (
        <ThreadListV2SectionDivider label="Pending" pane={props.pane} />
      ) : null}
      <ControlPillMenu
        actions={PENDING_TASK_MENU_ACTIONS}
        onPressAction={handleMenuAction}
        shouldOpenOnLongPress
      >
        <Pressable
          accessibilityHint="Opens the queued task for editing"
          accessibilityLabel={pendingTask.title}
          accessibilityRole="button"
          onPress={() => onSelectPendingTask(pendingTask)}
          style={
            sidebarPane
              ? ({ pressed }) => ({
                  backgroundColor: pressed ? pressedBackgroundColor : drawerColor,
                  borderRadius: SIDEBAR_V2_ROW_RADIUS,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                })
              : ({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })
          }
        >
          {sidebarPane ? (
            rowContent
          ) : sceneryChrome ? (
            <View
              style={threadListV2CardPlateStyle({ fill: chromeFill, borderColor: chromeBorder })}
            >
              <View className="px-4 py-2.5">{rowContent}</View>
            </View>
          ) : (
            <View className="bg-screen">
              <View className="px-5 py-2.5">{rowContent}</View>
              {props.showTrailingDivider !== false ? (
                <View className="ml-5 h-px bg-border-subtle" />
              ) : null}
            </View>
          )}
        </Pressable>
      </ControlPillMenu>
    </>
  );
});

export const ThreadListV2Row = memo(function ThreadListV2Row(props: {
  readonly thread: EnvironmentThreadShell;
  readonly variant: "card" | "slim";
  /** Snoozed-shelf row: shows its wake time and offers Wake. */
  readonly snoozed?: boolean;
  /** Settled-shelf row: with `snoozed`, completes a pending departure. */
  readonly settled?: boolean;
  /** Pinned-block row: shows the pin glyph and offers Unpin. */
  readonly pinned?: boolean;
  /** Preformatted against the parent minute tick so this memoized row's
      countdown keeps moving. */
  readonly snoozeWakeLabelText?: string;
  /** Parent minute tick passed as a prop so this memoized row refreshes its
      native snooze menu while mounted. */
  readonly snoozePresetMinute: string;
  readonly project: EnvironmentProject | null;
  readonly projectTitle?: string;
  readonly providerDriver: string | null;
  /** Which machine hosts the thread. Null when only one environment is
      connected — repeating the same label on every row is noise. Mirrors
      the web sidebar's remote-environment cloud icon, but as text since
      phones have no hover tooltips. */
  readonly environmentLabel: string | null;
  /** Hosting surface. "screen" (default) renders the compact Home idiom:
      flat edge-to-edge rows on the screen background with inset hairlines.
      "sidebar" renders the iPad split-view idiom: rounded rows blending
      into the drawer surface, selection filled with the accent color —
      matching the v1 sidebar rows. */
  readonly pane?: "screen" | "sidebar";
  /** Keeps row hairlines inside a section; section headers draw their own rule. */
  readonly showTrailingDivider?: boolean;
  /** Translucent chrome over World Scenery; ignored in the sidebar pane. */
  readonly sceneryChrome?: boolean;
  /** Highlights the thread open in the detail pane (iPad split view). The
      compact Home list never sets it — phones navigate away on select. */
  readonly selected?: boolean;
  /** Override for narrow panes (iPad sidebar); defaults to window width. */
  readonly fullSwipeWidth?: number;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onDeleteThread: (thread: EnvironmentThreadShell) => void;
  readonly onRegenerateThreadTitle: (thread: EnvironmentThreadShell) => void;
  readonly onRenameThread: (thread: EnvironmentThreadShell) => void;
  readonly onSettleThread: (thread: EnvironmentThreadShell) => void;
  readonly onSnoozeThread: (thread: EnvironmentThreadShell, snoozedUntil: string) => void;
  readonly onUnsnoozeThread: (thread: EnvironmentThreadShell) => void;
  readonly onUnsettleThread: (thread: EnvironmentThreadShell) => void;
  readonly onArchiveThread: (thread: EnvironmentThreadShell) => void;
  readonly onPinThread: (thread: EnvironmentThreadShell) => void;
  readonly onUnpinThread: (thread: EnvironmentThreadShell) => void;
  /** False on environments whose server predates thread.settle/unsettle:
      swipe + menu fall back to Archive instead of failing on use. */
  readonly settlementSupported: boolean;
  /** False on servers that predate thread.snooze/unsnooze. */
  readonly snoozeSupported: boolean;
  /** False on servers that predate thread.pin/unpin. */
  readonly pinningSupported: boolean;
  /** False on servers that predate thread title regeneration. */
  readonly titleRegenerationSupported: boolean;
  /** False on servers that predate thread.pin.reorder. Gates the pinned
      Move up / Move down menu items. */
  readonly pinReorderSupported?: boolean;
  readonly onMovePinnedThread?: (thread: EnvironmentThreadShell, direction: "up" | "down") => void;
  /** Position flags for the pinned block so the menu disables the move that
      would fall off the end of the list. */
  readonly canMovePinnedUp?: boolean;
  readonly canMovePinnedDown?: boolean;
  readonly onSwipeableWillOpen: (methods: SwipeableMethods) => void;
  readonly onSwipeableClose: (methods: SwipeableMethods) => void;
  /** Reports this row's live PR (state + last activity) for the partition's
      merge and close rules. Mirrors web's onChangeRequestState. */
  readonly onChangeRequestState?: (
    threadKey: string,
    changeRequest: ChangeRequestSettleSource | null,
  ) => void;
  readonly projectCwd?: string | null;
  readonly searchMatch?: EnvironmentThreadSearchMatch;
  readonly searchQuery?: string;
  readonly simultaneousSwipeGesture?: ComponentProps<
    typeof ThreadSwipeable
  >["simultaneousWithExternalGesture"];
}) {
  const { width: windowWidth } = useWindowDimensions();
  const {
    thread,
    variant,
    onSelectThread,
    onDeleteThread,
    onRegenerateThreadTitle,
    onRenameThread,
    onSettleThread,
    onSnoozeThread,
    onUnsnoozeThread,
    onUnsettleThread,
    onArchiveThread,
    onPinThread,
    onUnpinThread,
    onMovePinnedThread,
    onChangeRequestState,
  } = props;
  const snoozedRow = props.snoozed === true;
  const pinnedRow = props.pinned === true;

  const pr = useThreadPr(thread, props.projectCwd ?? props.project?.workspaceRoot ?? null);
  const prState = pr?.state ?? null;
  const prUpdatedAt = pr?.updatedAt ?? null;
  const threadKey = `${thread.environmentId}:${thread.id}`;
  useEffect(() => {
    onChangeRequestState?.(
      threadKey,
      prState === null ? null : { state: prState, updatedAt: prUpdatedAt },
    );
  }, [onChangeRequestState, prState, prUpdatedAt, threadKey]);

  const departure = useThreadDepartureAnimation(
    threadKey,
    props.snoozed === true || props.settled === true,
  );

  const screenColor = useThemeColor("--color-screen");
  const drawerColor = useThemeColor("--color-drawer");
  const pressedBackgroundColor = useThemeColor("--color-subtle");
  const selectedBackgroundColor = useThemeColor("--color-user-bubble");
  const pinTintColor = useThemeColor("--color-foreground-muted");
  const chromeFill = useThemeColor("--color-chrome-glass");
  const chromeBorder = useThemeColor("--color-chrome-glass-border");
  const sidebarPane = props.pane === "sidebar";
  const selected = props.selected === true;
  const sceneryChrome = props.sceneryChrome === true && !sidebarPane;

  const status = resolveThreadListV2Status(thread);
  const statusLabel = STATUS_LABEL_BY_STATUS[status];
  const timeLabel = threadTimeLabel(thread);

  const handleDelete = useCallback(() => onDeleteThread(thread), [onDeleteThread, thread]);
  const handleRegenerateTitle = useCallback(
    () => onRegenerateThreadTitle(thread),
    [onRegenerateThreadTitle, thread],
  );
  const handleRename = useCallback(() => onRenameThread(thread), [onRenameThread, thread]);
  const handleSettle = useCallback(() => onSettleThread(thread), [onSettleThread, thread]);
  const handleSnooze = useCallback(
    (snoozedUntil: string) => onSnoozeThread(thread, snoozedUntil),
    [onSnoozeThread, thread],
  );
  const handleUnsnooze = useCallback(() => onUnsnoozeThread(thread), [onUnsnoozeThread, thread]);
  const handleUnsettle = useCallback(() => onUnsettleThread(thread), [onUnsettleThread, thread]);
  const handlePin = useCallback(() => onPinThread(thread), [onPinThread, thread]);
  const handleUnpin = useCallback(() => onUnpinThread(thread), [onUnpinThread, thread]);
  const handleMovePinnedUp = useCallback(
    () => onMovePinnedThread?.(thread, "up"),
    [onMovePinnedThread, thread],
  );
  const handleMovePinnedDown = useCallback(
    () => onMovePinnedThread?.(thread, "down"),
    [onMovePinnedThread, thread],
  );
  const handleArchive = useCallback(() => onArchiveThread(thread), [onArchiveThread, thread]);

  // Swipe: the v2 primary action is the lifecycle transition. Every settled
  // row can un-settle — explicit settles clear the override, auto-settled
  // rows get pinned active until real activity clears the pin.
  const canUnsettle = variant === "slim";
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
  });
  const snoozePresets = useMemo(
    () => (swipeActions.secondary === "snooze" ? resolveSnoozePresets(new Date()) : ([] as const)),
    [props.snoozePresetMinute, swipeActions.secondary],
  );
  const snoozePresetActions = useMemo<MenuAction[]>(
    () =>
      snoozePresets.map((preset) => ({
        id: `snooze:${preset.id}`,
        title: preset.label,
        subtitle: preset.whenLabel,
      })),
    [snoozePresets],
  );
  // Pinned cards keep the full lifecycle menu; only the pin item flips to
  // Unpin. (Settling a pinned thread clears the pin server-side; snoozing
  // hides the card until wake with the pin intact.)
  const pinMenuItem = useMemo<MenuAction[]>(
    () =>
      props.pinningSupported
        ? [
            ...(pinnedRow && props.pinReorderSupported === true
              ? [
                  {
                    id: "move-pin-up",
                    title: "Move up",
                    image: "arrow.up",
                    attributes: { disabled: props.canMovePinnedUp !== true },
                  } satisfies MenuAction,
                  {
                    id: "move-pin-down",
                    title: "Move down",
                    image: "arrow.down",
                    attributes: { disabled: props.canMovePinnedDown !== true },
                  } satisfies MenuAction,
                ]
              : []),
            pinnedRow
              ? { id: "unpin", title: "Unpin", image: "pin.slash" }
              : { id: "pin", title: "Pin", image: "pin" },
          ]
        : [],
    [
      pinnedRow,
      props.canMovePinnedDown,
      props.canMovePinnedUp,
      props.pinReorderSupported,
      props.pinningSupported,
    ],
  );
  const titleRegenerationMenuItems = useMemo<MenuAction[]>(
    () =>
      buildThreadTitleRegenerationMenuItems({
        supported: props.titleRegenerationSupported,
        isRegenerating: thread.titleRegeneration != null,
      }),
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
      ...pinMenuItem,
      THREAD_RENAME_MENU_ACTION,
      ...titleRegenerationMenuItems,
      { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
    ],
    [pinMenuItem, snoozePresetActions, titleRegenerationMenuItems],
  );
  const cardMenuActions = useMemo<MenuAction[]>(
    () => [
      CARD_MENU_ACTIONS[0]!,
      ...pinMenuItem,
      THREAD_RENAME_MENU_ACTION,
      ...titleRegenerationMenuItems,
      ...CARD_MENU_ACTIONS.slice(1),
    ],
    [pinMenuItem, titleRegenerationMenuItems],
  );
  const slimMenuActions = useMemo<MenuAction[]>(
    () => [
      SLIM_MENU_ACTIONS[0]!,
      THREAD_RENAME_MENU_ACTION,
      ...titleRegenerationMenuItems,
      SLIM_MENU_ACTIONS[1]!,
    ],
    [titleRegenerationMenuItems],
  );
  const snoozedMenuActions = useMemo<MenuAction[]>(
    () => [
      SNOOZED_MENU_ACTIONS[0]!,
      THREAD_RENAME_MENU_ACTION,
      ...titleRegenerationMenuItems,
      SNOOZED_MENU_ACTIONS[1]!,
    ],
    [titleRegenerationMenuItems],
  );
  const legacyMenuActions = useMemo<MenuAction[]>(
    () => [
      LEGACY_MENU_ACTIONS[0]!,
      THREAD_RENAME_MENU_ACTION,
      ...titleRegenerationMenuItems,
      LEGACY_MENU_ACTIONS[1]!,
    ],
    [titleRegenerationMenuItems],
  );
  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "settle") handleSettle();
      if (nativeEvent.event === "unsettle") handleUnsettle();
      if (nativeEvent.event === "unsnooze") handleUnsnooze();
      if (nativeEvent.event === "pin") handlePin();
      if (nativeEvent.event === "unpin") handleUnpin();
      if (nativeEvent.event === "move-pin-up") handleMovePinnedUp();
      if (nativeEvent.event === "move-pin-down") handleMovePinnedDown();
      if (nativeEvent.event === "archive") handleArchive();
      if (nativeEvent.event === "rename") handleRename();
      if (nativeEvent.event === "regenerate-title") handleRegenerateTitle();
      if (nativeEvent.event === "delete") handleDelete();
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
      handleArchive,
      handleDelete,
      handleRegenerateTitle,
      handleMovePinnedDown,
      handleMovePinnedUp,
      handlePin,
      handleRename,
      handleSettle,
      handleSnooze,
      handleUnpin,
      handleUnsettle,
      handleUnsnooze,
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

  // The sidebar pane fills selected rows with the theme's message surface, so
  // every piece of row text must use that surface's paired foreground.
  const cardContent = (
    <>
      <View className="flex-row items-center gap-1.5">
        {props.project ? (
          <ProjectFavicon
            environmentId={thread.environmentId}
            faviconPath={props.project.faviconPath}
            size={15}
            projectTitle={props.projectTitle ?? props.project.title}
            workspaceRoot={props.project.workspaceRoot}
          />
        ) : null}
        <Text
          className={cn(
            "flex-1 text-sm font-t3-medium",
            selected ? "text-user-bubble-foreground-muted" : "text-foreground-muted",
          )}
          numberOfLines={1}
        >
          {props.projectTitle ?? props.project?.title ?? ""}
        </Text>
        {pinnedRow ? (
          <SymbolView name="pin" size={11} tintColor={pinTintColor} type="monochrome" />
        ) : null}
        <Text
          className={cn(
            "text-xs tabular-nums",
            selected
              ? "text-user-bubble-foreground"
              : (statusLabel?.className ?? "text-foreground-tertiary"),
          )}
        >
          {statusLabel?.label ?? timeLabel}
        </Text>
      </View>
      <Text
        className={cn(
          "mt-1 text-base font-t3-medium",
          selected ? "text-user-bubble-foreground" : "text-foreground",
        )}
        numberOfLines={2}
      >
        {thread.title}
      </Text>
      {props.searchMatch ? (
        <View className="mt-1">
          <ThreadSearchMatchExcerpt
            match={props.searchMatch}
            query={props.searchQuery ?? ""}
            selected={selected}
          />
        </View>
      ) : null}
      <View className="mt-1 flex-row items-center gap-2">
        {status === "failed" && thread.session?.lastError ? (
          <Text
            className={cn(
              "flex-1 text-xs",
              selected
                ? "text-user-bubble-foreground-muted"
                : "text-red-600/80 dark:text-red-400/80",
            )}
            numberOfLines={1}
          >
            {thread.session.lastError}
          </Text>
        ) : thread.branch || props.environmentLabel ? (
          /* "branch · machine" share one truncating line. The machine sits
             last so a tight fit cuts the repetitive label, not the branch —
             and machine-only fills the row for non-git projects. */
          <Text
            className={cn(
              "flex-1 text-xs",
              selected ? "text-user-bubble-foreground-muted" : "text-foreground-muted",
            )}
            numberOfLines={1}
          >
            {thread.branch ? (
              <Text
                className={cn(
                  "text-xs",
                  selected ? "text-user-bubble-foreground-muted" : "text-foreground-muted",
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
                  selected ? "text-user-bubble-foreground-muted" : "text-foreground-tertiary",
                )}
              >
                {props.environmentLabel}
              </Text>
            ) : null}
          </Text>
        ) : (
          <View className="flex-1" />
        )}
        {pr ? (
          <Text
            accessibilityLabel={pr.accessibilityLabel}
            className={cn("text-xs", selected ? "text-user-bubble-foreground" : pr.textClassName)}
            style={{ fontFamily: MONO_FONT }}
          >
            #{pr.label}
          </Text>
        ) : null}
        {props.providerDriver ? (
          <View className="opacity-60">
            <ProviderIcon provider={props.providerDriver} size={14} />
          </View>
        ) : null}
      </View>
    </>
  );

  const slimContent = (
    <>
      {props.project ? (
        <View className="opacity-40">
          <ProjectFavicon
            environmentId={thread.environmentId}
            faviconPath={props.project.faviconPath}
            size={15}
            projectTitle={props.projectTitle ?? props.project.title}
            workspaceRoot={props.project.workspaceRoot}
          />
        </View>
      ) : null}
      <View className="min-w-0 flex-1">
        <Text
          className={cn(
            "text-base",
            selected ? "text-user-bubble-foreground" : "text-foreground-muted",
          )}
          numberOfLines={1}
        >
          {thread.title}
        </Text>
        {props.searchMatch ? (
          <ThreadSearchMatchExcerpt
            match={props.searchMatch}
            query={props.searchQuery ?? ""}
            selected={selected}
          />
        ) : null}
      </View>
      <Text
        className={cn(
          "text-sm tabular-nums",
          selected
            ? "text-user-bubble-foreground-muted"
            : snoozedRow
              ? "text-blue-600 dark:text-blue-400"
              : "text-foreground-tertiary",
        )}
        style={{ fontFamily: MONO_FONT }}
      >
        {snoozedRow && props.snoozeWakeLabelText !== undefined
          ? props.snoozeWakeLabelText
          : relativeTime(thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt)}
      </Text>
    </>
  );

  const rowContent = (close: () => void) =>
    variant === "card" ? (
      <Pressable
        accessibilityHint={swipeAccessibilityHint}
        accessibilityLabel={thread.title}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => {
          close();
          onSelectThread(thread);
        }}
        style={
          sidebarPane
            ? ({ pressed }) => ({
                backgroundColor: selected
                  ? selectedBackgroundColor
                  : pressed
                    ? pressedBackgroundColor
                    : drawerColor,
                borderRadius: SIDEBAR_V2_ROW_RADIUS,
                paddingHorizontal: 12,
                paddingVertical: 10,
              })
            : ({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })
        }
      >
        {sidebarPane ? (
          cardContent
        ) : sceneryChrome ? (
          <View style={threadListV2CardPlateStyle({ fill: chromeFill, borderColor: chromeBorder })}>
            <View className="px-4 py-2.5">{cardContent}</View>
          </View>
        ) : (
          /* Opaque plates when scenery is off so swipe actions reveal a
             solid screen behind the row. */
          <View className="bg-screen">
            <View className="px-5 py-2.5">{cardContent}</View>
            {props.showTrailingDivider !== false ? (
              <View className="ml-5 h-px bg-border-subtle" />
            ) : null}
          </View>
        )}
      </Pressable>
    ) : (
      <Pressable
        accessibilityHint={swipeAccessibilityHint}
        accessibilityLabel={thread.title}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        className={sidebarPane || sceneryChrome ? undefined : "bg-screen"}
        onPress={() => {
          close();
          onSelectThread(thread);
        }}
        style={
          sidebarPane
            ? ({ pressed }) => ({
                backgroundColor: selected
                  ? selectedBackgroundColor
                  : pressed
                    ? pressedBackgroundColor
                    : drawerColor,
                borderRadius: SIDEBAR_V2_ROW_RADIUS,
              })
            : ({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })
        }
      >
        {/* Settled history recedes: dimmed favicon + muted title. Over
            scenery it still sits on a card, just quieter than the inbox. */}
        {sceneryChrome ? (
          <View
            style={threadListV2CardPlateStyle({
              fill: chromeFill,
              borderColor: chromeBorder,
              compact: true,
            })}
          >
            <View className="min-h-[44px] flex-row items-center gap-2.5 px-4 py-2.5">
              {slimContent}
            </View>
          </View>
        ) : (
          <View
            className={cn(
              "min-h-[44px] flex-row items-center gap-2.5 py-2",
              sidebarPane ? "px-3" : "px-5",
            )}
          >
            {slimContent}
          </View>
        )}
      </Pressable>
    );

  return (
    <Animated.View pointerEvents={departure.departing ? "none" : "auto"} style={departure.style}>
      <ThreadSwipeable
        backgroundColor={sidebarPane ? drawerColor : sceneryChrome ? "transparent" : screenColor}
        compactActions={variant === "slim"}
        containerStyle={
          sidebarPane ? { borderRadius: SIDEBAR_V2_ROW_RADIUS, overflow: "hidden" } : undefined
        }
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
        resetKey={`${thread.environmentId}:${thread.id}`}
        simultaneousWithExternalGesture={props.simultaneousSwipeGesture}
        threadTitle={thread.title}
      >
        {(close) => (
          <ControlPillMenu
            actions={
              snoozedRow
                ? snoozedMenuActions
                : !props.settlementSupported
                  ? legacyMenuActions
                  : canUnsettle
                    ? slimMenuActions
                    : swipeActions.secondary === "snooze"
                      ? snoozableCardMenuActions
                      : cardMenuActions
            }
            onPressAction={handleMenuAction}
            shouldOpenOnLongPress
          >
            {rowContent(close)}
          </ControlPillMenu>
        )}
      </ThreadSwipeable>
    </Animated.View>
  );
});
