import type { MenuAction } from "@react-native-menu/menu";
import { skillMentionToken } from "@t3tools/shared/skillTool";
import { T3CODE_BUILD_FLAVOR } from "@t3tools/shared/connectBranding";
import type {
  EnvironmentId,
  MessageId,
  ModelSelection,
  OrchestrationThreadShell,
  ProviderInteractionMode,
  RuntimeMode,
  ServerConfig as T3ServerConfig,
  TurnDeliveryMode,
} from "@t3tools/contracts";
import { displayRuntimeModeForProviderDriver } from "@t3tools/contracts";
import {
  detectComposerTrigger,
  replaceTextRange,
  serializeComposerFileLink,
  type ComposerTrigger,
} from "@t3tools/shared/composerTrigger";
import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import type { ReactNode } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import * as Option from "effect/Option";
import ImageViewing from "react-native-image-viewing";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  LinearTransition,
} from "react-native-reanimated";
import { useThemeColor } from "../../lib/useThemeColor";
import { themeColorWithAlpha } from "../../lib/mobileTheme";
import { armAgentAwarenessLiveActivityForLocalWork } from "../agent-awareness/remoteRegistration";
import { scopedThreadKey } from "../../lib/scopedEntities";

import { AppText as Text } from "../../components/AppText";
import {
  ComposerAttachmentStrip,
  ComposerAttachmentThumb,
  ComposerDispatchStatusLabel,
  type ComposerAttachmentPreview,
} from "../../components/ComposerAttachmentStrip";
import {
  composerDispatchStatusLabel,
  shouldKeepLocalComposerSendBusy,
} from "../../lib/composerDispatchStatus";
import { COMPOSER_SEND_INDICATOR_MIN_MS } from "../../components/ComposerSendIndicator";
import { GlassSurface } from "../../components/GlassSurface";
import {
  ComposerEditor,
  type ComposerEditorHandle,
  type ComposerEditorSelection,
} from "../../components/ComposerEditor";
import {
  ComposerInlineControl,
  ComposerToolbarButton,
  ComposerToolbarRow,
  ComposerToolbarScroller,
} from "../../components/ComposerToolbar";
import { ControlPill, ControlPillMenu } from "../../components/ControlPill";
import { ProviderIcon } from "../../components/ProviderIcon";
import type { DraftComposerImageAttachment } from "../../lib/composerImages";
import {
  buildModelOptions,
  groupByProvider,
  type ModelOption,
  resolveThreadProviderGroups,
} from "../../lib/modelOptions";
import { appAvatarColor, attachableAppMatches } from "../settings/apps/appsSettings.logic";
import { useScaledTextRole } from "../settings/appearance/useScaledTextRole";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useReduceTransparency } from "../scenery/useReduceTransparency";
import type { RemoteClientConnectionState } from "../../lib/connection";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";
import {
  applyProviderOptionSelection,
  resolveProviderOptionDescriptors,
} from "../../lib/providerOptions";
import { useComposerPathSearch } from "../../state/use-composer-path-search";
import { ComposerCommandPopover, type ComposerCommandItem } from "./ComposerCommandPopover";
import { matchesSlashSkillQuery } from "./composerSlashSkillSearch";
import { buildThreadSettingsPickerModel } from "./thread-settings-picker";
import { ThreadModelIdentityCaption } from "./ThreadModelIdentityCaption";
import { ThreadSettingsPickerPopover } from "./ThreadSettingsPickerPopover";
import {
  type ExistingThreadSettingsRouteSession,
  threadSettingsSummaryLabel,
  useExistingThreadSettingsRoutePresentation,
} from "./ThreadSettingsSheet";
import { buildThreadModelIdentity } from "./threadModelIdentity";
import {
  useThreadSettingsSheetPresentation,
  type NavigationWithFinishTransitioning,
} from "./use-thread-settings-sheet-presentation";
import { usePreparedConnection } from "../../state/session";
import { useNativeDictation } from "./useNativeDictation";

/**
 * Height of the collapsed composer (pill + model caption below it + vertical
 * padding, excluding safe-area inset). Exported so the parent can compute
 * feed overlap / content insets.
 */
export const COMPOSER_COLLAPSED_CHROME = 86;

/**
 * Height of the expanded composer (card + toolbar + vertical padding, excluding safe-area inset).
 * Used by the parent to compute the larger feed bottom inset when the composer is focused.
 */
export const COMPOSER_EXPANDED_CHROME = 156;

export interface ThreadComposerProps {
  readonly draftMessage: string;
  readonly draftAttachments: ReadonlyArray<DraftComposerImageAttachment>;
  readonly placeholder: string;
  readonly contentMaxWidth?: number;
  readonly bottomInset?: number;
  readonly connectionState: RemoteClientConnectionState;
  readonly connectionError: string | null;
  readonly environmentLabel: string | null;
  /**
   * Message sync phase for the selected thread (drives the status pill):
   * "loading" = first fetch, nothing to show yet; "syncing" = cached messages
   * are on screen while they reconcile with the server.
   */
  readonly threadSyncPhase?: "loading" | "syncing" | null;
  readonly selectedThread: OrchestrationThreadShell;
  readonly serverConfig: T3ServerConfig | null;
  readonly queueCount: number;
  readonly headQueuedMessageId: MessageId | null;
  readonly isHeadQueuedMessageRetrying: boolean;
  readonly isDeliveringQueuedMessage: boolean;
  readonly activeThreadBusy: boolean;
  readonly environmentId: EnvironmentId;
  readonly projectCwd: string | null;
  readonly editorRef?: RefObject<ComposerEditorHandle | null>;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly onPickDraftImages: (input?: {
    readonly onPicked?: (
      previews: ReadonlyArray<{ readonly id: string; readonly previewUri: string }>,
    ) => void;
  }) => Promise<void>;
  readonly onNativePasteImages: (uris: ReadonlyArray<string>) => Promise<void>;
  readonly onRemoveDraftImage: (imageId: string) => void;
  readonly onStopThread: () => void;
  readonly onSendMessage: (delivery?: TurnDeliveryMode) => Promise<MessageId | null>;
  readonly onUpdateModelSelection: (modelSelection: ModelSelection) => void;
  readonly onUpdateRuntimeMode: (runtimeMode: RuntimeMode) => void;
  readonly onUpdateInteractionMode: (interactionMode: ProviderInteractionMode) => void;
  readonly onReconnectEnvironment: () => void;
  readonly onExpandedChange?: (expanded: boolean) => void;
  /** Fires on editor focus/blur; hosts use it to vet stale keyboard state. */
  readonly onEditorFocusChange?: (focused: boolean) => void;
}

/**
 * The pill / card container — renders with Expo's native GlassView on supported
 * iOS 26+ devices and keeps the existing opaque fallback elsewhere.
 * Exported so NewTaskDraftScreen can render the same composer chrome.
 */
// One timing for every piece of the expanded↔compact morph so the surface,
// toolbar, and siblings move together instead of popping between layouts.
// Android gets NO layout transition: the composer rides the keyboard via
// KeyboardStickyView (frame-synced to the IME), and a time-based morph
// running alongside that translate reads as jitter. Snapping the layout and
// letting the keyboard-synced slide be the only motion looks native there.
const COMPOSER_LAYOUT_TRANSITION =
  Platform.OS === "android" ? undefined : LinearTransition.duration(220);

const COMPOSER_EXPANDED_SURFACE_STYLE: ViewStyle = {
  borderRadius: 20,
  overflow: "hidden",
  paddingHorizontal: 14,
  paddingVertical: 12,
};

const COMPOSER_COLLAPSED_SURFACE_STYLE: ViewStyle = {
  borderRadius: 999,
  overflow: "hidden",
  flexDirection: "row",
  alignItems: "center",
  paddingLeft: 18,
  paddingRight: 5,
  paddingVertical: 5,
};

const COMPOSER_EXPANDED_EDITOR_STYLE: ViewStyle = {
  minHeight: 80,
  maxHeight: 160,
  paddingHorizontal: 4,
  paddingVertical: 4,
};

const COMPOSER_COLLAPSED_EDITOR_STYLE: ViewStyle = {
  height: 36,
};

export function ComposerSurface(props: {
  readonly children: ReactNode;
  readonly style: ViewStyle;
  readonly isDarkMode: boolean;
  /**
   * Existing thread composers morph between pill and card layouts; pass false
   * to skip the morph while the editor is focused.
   */
  readonly animateLayout?: boolean;
}) {
  const cardColor = useThemeColor("--color-card-translucent");
  const borderColor = useThemeColor("--color-border");
  const shadowColor = useThemeColor("--color-primary-shadow");
  // Drop shadow lives on a wrapper: `overflow: "hidden"` on the surface itself
  // (needed to clip content to the pill shape) would clip the shadow on iOS.
  const shadowStyle: ViewStyle = {
    borderRadius: props.style.borderRadius,
    shadowColor,
    shadowOpacity: props.isDarkMode ? 0.35 : 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  };
  const layout = props.animateLayout === false ? undefined : COMPOSER_LAYOUT_TRANSITION;
  // Reduce Transparency swaps the live-sampling glass for a solid plate.
  const reduceTransparency = useReduceTransparency();

  if (reduceTransparency) {
    return (
      <Animated.View layout={layout} style={shadowStyle}>
        <View
          style={[
            props.style,
            {
              backgroundColor: props.isDarkMode ? "#2c2c2e" : "#ffffff",
              borderWidth: 1,
              borderColor: props.isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
            },
          ]}
        >
          {props.children}
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View layout={layout} style={shadowStyle}>
      <GlassSurface
        chrome="none"
        fallbackStyle={{
          backgroundColor: cardColor,
          borderWidth: 1,
          borderColor,
        }}
        glassEffectStyle="regular"
        // The composer is a passive material containing interactive controls.
        // Expo GlassView defaults to non-interactive and both layouts share it.
        tintColor="transparent"
        style={props.style}
      >
        {props.children}
      </GlassSurface>
    </Animated.View>
  );
}

type ComposerStatusPillState = {
  readonly kind: "unavailable" | "reconnecting" | "syncing";
  readonly label: string;
};

function composerConnectionStatus(input: {
  readonly connectionError: string | null;
  readonly connectionState: RemoteClientConnectionState;
  readonly environmentLabel: string | null;
  readonly threadSyncPhase?: "loading" | "syncing" | null;
}): ComposerStatusPillState | null {
  const environmentLabel = input.environmentLabel ?? "Environment";

  switch (input.connectionState) {
    case "connecting":
    case "reconnecting":
      return {
        kind: "reconnecting",
        label:
          input.connectionError === null
            ? `Reconnecting to ${environmentLabel}...`
            : `Failed to connect. Retrying ${environmentLabel}...`,
      };
    case "offline":
      return { kind: "unavailable", label: "You are offline" };
    case "error":
      return {
        kind: "unavailable",
        label: input.connectionError
          ? `Failed to connect to ${environmentLabel}: ${input.connectionError}`
          : `Failed to connect to ${environmentLabel}`,
      };
    case "available":
      return { kind: "unavailable", label: `${environmentLabel} is not connected` };
    case "connected":
      break;
  }

  // Connected: the pill is the single loading/sync indicator. One stable
  // label per open — "Loading" when starting from scratch, "Syncing" when
  // cached messages are already visible.
  switch (input.threadSyncPhase) {
    case "loading":
      return { kind: "syncing", label: "Loading messages..." };
    case "syncing":
      return { kind: "syncing", label: "Syncing messages..." };
    default:
      return null;
  }
}

const ComposerConnectionStatusPill = memo(function ComposerConnectionStatusPill(props: {
  readonly onPress: () => void;
  readonly status: ComposerStatusPillState;
}) {
  const isReconnecting = props.status.kind !== "unavailable";
  const indicatorColor = useThemeColor("--color-icon-muted");

  return (
    <Animated.View
      key={props.status.kind}
      className="absolute inset-x-0 bottom-full items-center pb-2"
      // Sync pills wait a beat before appearing: a cached thread finishes
      // syncing inside the delay, so fast thread switches never flash a
      // "Loading messages..." pill. Connection problems still show instantly.
      // Keyed on kind so a syncing → error swap remounts without the delay.
      entering={
        props.status.kind === "syncing"
          ? FadeInDown.delay(300).duration(180)
          : FadeInDown.duration(180)
      }
      exiting={FadeOutDown.duration(140)}
      pointerEvents="box-none"
    >
      {/* Sync status is a label, not a retry affordance: retrying while
          connected tears down the healthy socket the sync is running on. */}
      <Pressable
        accessibilityRole={props.status.kind === "syncing" ? "text" : "button"}
        disabled={props.status.kind === "syncing"}
        onPress={props.onPress}
        className="max-w-full flex-row items-center gap-2 rounded-full bg-card px-3 py-2 shadow-sm active:opacity-70"
      >
        {isReconnecting ? (
          <ActivityIndicator size="small" color={indicatorColor} />
        ) : (
          <View className="h-2 w-2 rounded-full bg-red-500" />
        )}
        <Text
          className="max-w-[260px] text-sm font-t3-bold leading-snug text-foreground"
          numberOfLines={1}
        >
          {props.status.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

export const ThreadComposer = memo(function ThreadComposer(props: ThreadComposerProps) {
  const navigation = useNavigation();
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";
  const foregroundColor = useThemeColor("--color-foreground");
  const bodyText = useScaledTextRole("body");
  const fallbackInputRef = useRef<ComposerEditorHandle>(null);
  const inputRef = props.editorRef ?? fallbackInputRef;
  const [isFocused, setIsFocused] = useState(false);
  const settingsSheetPresentation = useThreadSettingsSheetPresentation({
    editorRef: inputRef,
    isEditorFocused: isFocused,
  });
  const settingsRoutePresentation = useExistingThreadSettingsRoutePresentation();
  const settingsRoutePresentedRef = useRef(false);
  const wasExpandedBeforePreviewRef = useRef(false);
  const inFlightThreadIdsRef = useRef(new Set<string>());
  const wasFocusedRef = useRef(false);
  const { onExpandedChange } = props;

  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [inFlightMessageId, setInFlightMessageId] = useState<MessageId | null>(null);
  const [pendingPreviews, setPendingPreviews] = useState<ReadonlyArray<ComposerAttachmentPreview>>(
    [],
  );
  const preparingImagesRef = useRef(false);
  const previewFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendStartedAtRef = useRef(0);
  const hasContent = props.draftMessage.trim().length > 0 || props.draftAttachments.length > 0;
  const isDispatching = isSending || pendingPreviews.length > 0 || props.isDeliveringQueuedMessage;
  const [composerSelection, setComposerSelection] = useState(() => ({
    start: props.draftMessage.length,
    end: props.draftMessage.length,
  }));
  const handleSelectionChange = useCallback((selection: ComposerEditorSelection) => {
    setComposerSelection(selection);
  }, []);
  const preparedConnection = usePreparedConnection(props.environmentId);
  const supportsVoiceDictation =
    T3CODE_BUILD_FLAVOR === "internal" &&
    props.serverConfig?.environment.capabilities.voiceDictation === true;
  const reportDictationError = useCallback((message: string) => {
    Alert.alert("Voice dictation", message);
  }, []);
  const dictation = useNativeDictation({
    enabled: supportsVoiceDictation && !isDispatching,
    prepared: Option.getOrNull(preparedConnection),
    value: props.draftMessage,
    cursor: composerSelection.end,
    onChangeValue: props.onChangeDraftMessage,
    onChangeCursor: (cursor) => setComposerSelection({ start: cursor, end: cursor }),
    reportError: reportDictationError,
  });
  // Recording can make the native editor resign first responder; keep the
  // toolbar visible so the Stop control remains reachable.
  const isExpanded = isFocused || settingsSheetPresentation.isActive || dictation.active;
  const canSend = hasContent;
  const stripAttachments = useMemo((): ComposerAttachmentPreview[] => {
    const attachedUris = new Set(props.draftAttachments.map((image) => image.previewUri));
    return [
      ...props.draftAttachments,
      ...pendingPreviews.filter((preview) => !attachedUris.has(preview.previewUri)),
    ];
  }, [pendingPreviews, props.draftAttachments]);
  const dispatchStatus = composerDispatchStatusLabel(
    pendingPreviews.length > 0
      ? { kind: "preparing-images", count: pendingPreviews.length }
      : isSending || props.isDeliveringQueuedMessage
        ? {
            kind: "sending",
            creatingThread: false,
            connected: props.connectionState === "connected",
          }
        : { kind: "idle" },
  );

  useEffect(() => {
    if (!isSending) {
      return;
    }
    if (
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: props.isDeliveringQueuedMessage,
        isAwaitingEnqueue: inFlightMessageId === null,
        connected: props.connectionState === "connected",
        threadBusy: props.activeThreadBusy,
        isNextInQueue: props.headQueuedMessageId === inFlightMessageId,
        isWaitingForRetry:
          inFlightMessageId !== null &&
          props.isHeadQueuedMessageRetrying &&
          props.headQueuedMessageId === inFlightMessageId,
      })
    ) {
      return;
    }
    const remainingMs = Math.max(
      0,
      COMPOSER_SEND_INDICATOR_MIN_MS - (Date.now() - sendStartedAtRef.current),
    );
    const release = setTimeout(() => {
      setIsSending(false);
      setInFlightMessageId(null);
    }, remainingMs);
    return () => {
      clearTimeout(release);
    };
  }, [
    inFlightMessageId,
    isSending,
    props.activeThreadBusy,
    props.connectionState,
    props.headQueuedMessageId,
    props.isDeliveringQueuedMessage,
    props.isHeadQueuedMessageRetrying,
  ]);

  // Notify the parent from the derived value, not focus events: the parent
  // sizes the feed inset from this, and blur-during-sheet would otherwise
  // report collapsed while the composer still renders expanded.
  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);

  const onPressImage = useCallback(
    (uri: string) => {
      wasExpandedBeforePreviewRef.current = isFocused;
      setPreviewImageUri(uri);
    },
    [isFocused],
  );

  const closePreview = useCallback(() => {
    setPreviewImageUri(null);
    if (wasExpandedBeforePreviewRef.current) {
      if (previewFocusTimerRef.current) {
        clearTimeout(previewFocusTimerRef.current);
      }
      previewFocusTimerRef.current = setTimeout(() => {
        previewFocusTimerRef.current = null;
        inputRef.current?.focus();
      }, 100);
    }
  }, [inputRef]);

  useEffect(
    () => () => {
      if (previewFocusTimerRef.current) {
        clearTimeout(previewFocusTimerRef.current);
      }
    },
    [],
  );

  const onEditorFocusChange = props.onEditorFocusChange;
  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onEditorFocusChange?.(true);
  }, [onEditorFocusChange]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    onEditorFocusChange?.(false);
  }, [onEditorFocusChange]);
  const editorTextStyle = useMemo(
    () => ({
      ...bodyText,
      color: foregroundColor,
    }),
    [bodyText, foregroundColor],
  );
  // Keep the expand/collapse morph on the focus/blur frame, but do not layout-
  // animate the first-responder's ancestors afterward. Reanimated snapshots
  // of a focused UITextView reload the iOS 26+ keyboard session.
  const composerLayoutTransition =
    isFocused && wasFocusedRef.current ? undefined : COMPOSER_LAYOUT_TRANSITION;
  useLayoutEffect(() => {
    wasFocusedRef.current = isFocused;
  }, [isFocused]);
  const showStopAction =
    props.selectedThread.session?.status === "running" ||
    props.selectedThread.session?.status === "starting";

  // What a tap delivers, and therefore what the button says — one source of
  // truth so the label cannot promise one behavior and send another. Offline
  // parks the message for the next turn boundary; a connected running turn
  // steers on tap (long-press queues); a still-draining outbox queues behind
  // its siblings; an idle connected send leaves the server default (steer).
  const sendDelivery: TurnDeliveryMode | undefined =
    props.connectionState !== "connected"
      ? "queue"
      : showStopAction
        ? "steer"
        : props.queueCount > 0
          ? "queue"
          : undefined;
  const sendLabel = sendDelivery === "queue" ? "Queue" : "Send";
  const currentModelSelection = props.selectedThread.modelSelection;
  const storedRuntimeMode = props.selectedThread.runtimeMode;
  const currentInteractionMode = props.selectedThread.interactionMode ?? "default";
  const connectionStatus = composerConnectionStatus({
    connectionError: props.connectionError,
    connectionState: props.connectionState,
    environmentLabel: props.environmentLabel,
    threadSyncPhase: props.threadSyncPhase,
  });
  const toolbarSurface = String(useThemeColor("--color-card"));
  const backdropSurface = String(useThemeColor("--color-screen"));
  const toolbarFadeOpaque = themeColorWithAlpha(toolbarSurface, 0.95);
  const toolbarFadeTransparent = themeColorWithAlpha(toolbarSurface, 0);
  const backdropGradient = `linear-gradient(to bottom, ${themeColorWithAlpha(backdropSurface, 0)} 0%, ${themeColorWithAlpha(backdropSurface, 0.6)} 55%, ${themeColorWithAlpha(backdropSurface, 0.9)} 100%)`;
  const selectedProviderStatus = useMemo(() => {
    if (!props.serverConfig) return null;
    return (
      props.serverConfig.providers.find(
        (p) => p.instanceId === props.selectedThread.modelSelection.instanceId,
      ) ?? null
    );
  }, [props.serverConfig, props.selectedThread.modelSelection.instanceId]);

  // ── Trigger detection ────────────────────────────────────
  useEffect(() => {
    const end = props.draftMessage.length;
    setComposerSelection((selection) => {
      const start = Math.min(selection.start, end);
      const selectionEnd = Math.min(selection.end, end);
      if (start === selection.start && selectionEnd === selection.end) {
        return selection;
      }
      return { start, end: selectionEnd };
    });
  }, [props.draftMessage.length]);

  const composerTrigger = useMemo<ComposerTrigger | null>(() => {
    if (composerSelection.start !== composerSelection.end) {
      return null;
    }
    return detectComposerTrigger(props.draftMessage, composerSelection.end);
  }, [composerSelection, props.draftMessage]);
  const pathSearch = useComposerPathSearch({
    environmentId: props.environmentId,
    cwd: composerTrigger?.kind === "path" ? props.projectCwd : null,
    query: composerTrigger?.kind === "path" ? composerTrigger.query : null,
  });

  const composerMenuItems: ComposerCommandItem[] = useMemo(() => {
    if (!composerTrigger) return [];

    if (composerTrigger.kind === "slash-command") {
      const q = composerTrigger.query.toLowerCase();
      const allBuiltIn = [
        {
          id: "cmd:model",
          type: "slash-command" as const,
          command: "model",
          label: "/model",
          description: "Switch model",
        },
        {
          id: "cmd:plan",
          type: "slash-command" as const,
          command: "plan",
          label: "/plan",
          description: "Switch to plan mode",
        },
        {
          id: "cmd:default",
          type: "slash-command" as const,
          command: "default",
          label: "/default",
          description: "Switch to default mode",
        },
      ];
      const builtIn = allBuiltIn.filter((item) => item.command.includes(q));

      const providerCommands: ComposerCommandItem[] = [];
      for (const cmd of selectedProviderStatus?.slashCommands ?? []) {
        if (!cmd.name.toLowerCase().includes(q)) continue;
        providerCommands.push({
          id: `pcmd:${cmd.name}`,
          type: "provider-slash-command" as const,
          command: cmd,
          label: `/${cmd.name}`,
          description: cmd.description ?? "",
        });
      }

      const skillItems = (selectedProviderStatus?.skills ?? [])
        .filter((skill) => matchesSlashSkillQuery(skill, q))
        .map((skill) => ({
          id: `skill:${skill.name}`,
          type: "skill" as const,
          skill,
          label: `skill:${skill.name}`,
          description: skill.shortDescription ?? skill.description ?? "",
        }));

      return [...builtIn, ...providerCommands, ...skillItems];
    }

    if (composerTrigger.kind === "skill") {
      const enabledSkills = (selectedProviderStatus?.skills ?? []).filter((s) => s.enabled);
      const normalizedQuery = normalizeSearchQuery(composerTrigger.query, {
        trimLeadingPattern: /^\$+/,
      });

      if (!normalizedQuery) {
        return enabledSkills.slice(0, 20).map((skill) => ({
          id: `skill:${skill.name}`,
          type: "skill" as const,
          skill,
          label: skill.displayName ?? skill.name,
          description: skill.shortDescription ?? skill.description ?? "",
        }));
      }

      const ranked: Array<{
        item: (typeof enabledSkills)[number];
        score: number;
        tieBreaker: string;
      }> = [];
      for (const skill of enabledSkills) {
        const displayLabel = (skill.displayName ?? skill.name).toLowerCase();
        const scores = [
          scoreQueryMatch({
            value: skill.name.toLowerCase(),
            query: normalizedQuery,
            exactBase: 0,
            prefixBase: 2,
            boundaryBase: 4,
            includesBase: 6,
            fuzzyBase: 100,
            boundaryMarkers: ["-", "_", "/"],
          }),
          scoreQueryMatch({
            value: displayLabel,
            query: normalizedQuery,
            exactBase: 1,
            prefixBase: 3,
            boundaryBase: 5,
            includesBase: 7,
            fuzzyBase: 110,
          }),
          scoreQueryMatch({
            value: skill.shortDescription?.toLowerCase() ?? "",
            query: normalizedQuery,
            exactBase: 20,
            prefixBase: 22,
            boundaryBase: 24,
            includesBase: 26,
          }),
          scoreQueryMatch({
            value: skill.description?.toLowerCase() ?? "",
            query: normalizedQuery,
            exactBase: 30,
            prefixBase: 32,
            boundaryBase: 34,
            includesBase: 36,
          }),
        ].filter((s): s is number => s !== null);

        if (scores.length > 0) {
          insertRankedSearchResult(
            ranked,
            {
              item: skill,
              score: Math.min(...scores),
              tieBreaker: `${displayLabel}\u0000${skill.name}`,
            },
            20,
          );
        }
      }

      return ranked.map(({ item: skill }) => ({
        id: `skill:${skill.name}`,
        type: "skill" as const,
        skill,
        label: skill.displayName ?? skill.name,
        description: skill.shortDescription ?? skill.description ?? "",
      }));
    }

    if (composerTrigger.kind === "path") {
      const fileItems = pathSearch.entries.map((entry) => {
        const parts = entry.path.split("/");
        return {
          id: `path:${entry.path}`,
          type: "path" as const,
          path: entry.path,
          kind: entry.kind,
          label: parts[parts.length - 1] ?? entry.path,
          description: parts.length > 1 ? parts.slice(0, -1).join("/") : "",
        };
      });
      const apps = props.serverConfig?.settings.apps;
      const appItems = apps
        ? attachableAppMatches(apps, composerTrigger.query, 8).map((connection) => ({
            id: `app:${connection.id}`,
            type: "app" as const,
            slug: connection.slug,
            color: appAvatarColor(connection.catalogId),
            label: connection.name,
            description: `@${connection.slug}`,
          }))
        : [];
      return [...fileItems, ...appItems];
    }

    return [];
  }, [composerTrigger, pathSearch.entries, props.serverConfig, selectedProviderStatus]);

  // ── Handle command selection ──────────────────────────────
  const { onChangeDraftMessage, onUpdateInteractionMode, draftMessage, onSendMessage } = props;

  const beginPendingPreviews = useCallback(
    (previews: ReadonlyArray<{ readonly id: string; readonly previewUri: string }>) => {
      setPendingPreviews(previews.map((preview) => ({ ...preview, preparing: true })));
    },
    [],
  );

  const handlePickDraftImages = useCallback(async () => {
    if (isDispatching || preparingImagesRef.current) {
      return;
    }
    preparingImagesRef.current = true;
    try {
      await props.onPickDraftImages({ onPicked: beginPendingPreviews });
    } finally {
      preparingImagesRef.current = false;
      setPendingPreviews([]);
    }
  }, [beginPendingPreviews, isDispatching, props.onPickDraftImages]);

  const handleNativePasteImages = useCallback(
    async (uris: ReadonlyArray<string>) => {
      if (uris.length === 0 || isDispatching || preparingImagesRef.current) {
        return;
      }
      preparingImagesRef.current = true;
      beginPendingPreviews(
        uris.map((uri, index) => ({
          id: `pending:${index}:${uri}`,
          previewUri: uri,
        })),
      );
      try {
        await props.onNativePasteImages(uris);
      } finally {
        preparingImagesRef.current = false;
        setPendingPreviews([]);
      }
    },
    [beginPendingPreviews, isDispatching, props.onNativePasteImages],
  );

  // Stable void wrapper: an inline paste handler would rebuild every render and
  // snapshot the focused native editor, which reloads the iOS keyboard session.
  const handlePasteImages = useCallback(
    (uris: ReadonlyArray<string>) => {
      void handleNativePasteImages(uris);
    },
    [handleNativePasteImages],
  );

  const handleSend = useCallback(
    async (delivery?: TurnDeliveryMode) => {
      const threadKey = scopedThreadKey(props.environmentId, props.selectedThread.id);
      if (inFlightThreadIdsRef.current.has(threadKey) || isDispatching) return;
      inFlightThreadIdsRef.current.add(threadKey);
      sendStartedAtRef.current = Date.now();
      setIsSending(true);
      try {
        const messageId = await onSendMessage(delivery);
        if (messageId === null) {
          setIsSending(false);
          setInFlightMessageId(null);
          return;
        }
        setInFlightMessageId(messageId);
        // Sending a prompt starts agent work: arm the lock-screen card while the
        // app is foregrounded and the activity token can be registered. Armed
        // after the send so its preference read and native Activity start don't
        // contend with the queued-message feedback on the tap frame.
        armAgentAwarenessLiveActivityForLocalWork({
          environmentId: props.environmentId,
          threadTitle: props.selectedThread.title,
          projectTitle: props.environmentLabel ?? "T3 Pretty",
        });
      } finally {
        inFlightThreadIdsRef.current.delete(threadKey);
      }
    },
    [
      isDispatching,
      onSendMessage,
      props.environmentId,
      props.environmentLabel,
      props.selectedThread.id,
      props.selectedThread.title,
    ],
  );
  const handleSendPress = useCallback(() => {
    void handleSend(sendDelivery);
  }, [handleSend, sendDelivery]);
  const handleSendMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "queue") void handleSend("queue");
    },
    [handleSend],
  );
  // Kept mounted for the whole running turn (its host is a native menu view,
  // so remounting it on every keystroke would flicker the send button).
  const sendMenuActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "queue",
        title: "Queue for next turn",
        attributes: { disabled: !canSend || isDispatching },
      },
    ],
    [canSend, isDispatching],
  );
  const handleCommandSelect = useCallback(
    (item: ComposerCommandItem) => {
      if (!composerTrigger) return;

      if (
        item.type === "slash-command" &&
        (item.command === "plan" || item.command === "default")
      ) {
        const result = replaceTextRange(
          draftMessage,
          composerTrigger.rangeStart,
          composerTrigger.rangeEnd,
          "",
        );
        setComposerSelection({ start: result.cursor, end: result.cursor });
        onChangeDraftMessage(result.text);
        onUpdateInteractionMode(item.command);
        return;
      }

      let replacement = "";
      if (item.type === "path") {
        replacement = `${serializeComposerFileLink(item.path)} `;
      } else if (item.type === "skill") {
        replacement = `$${skillMentionToken(item.skill.name)} `;
      } else if (item.type === "app") {
        // Bare `@slug`: the server matches it against connected apps.
        replacement = `@${item.slug} `;
      } else if (item.type === "slash-command") {
        replacement = `/${item.command} `;
      } else if (item.type === "provider-slash-command") {
        replacement = `/${item.command.name} `;
      }

      const result = replaceTextRange(
        draftMessage,
        composerTrigger.rangeStart,
        composerTrigger.rangeEnd,
        replacement,
      );
      setComposerSelection({ start: result.cursor, end: result.cursor });
      onChangeDraftMessage(result.text);
    },
    [composerTrigger, draftMessage, onChangeDraftMessage, onUpdateInteractionMode],
  );

  // ── Model menu ───────────────────────────────────────────
  const modelOptions = useMemo(
    () => buildModelOptions(props.serverConfig, currentModelSelection),
    [props.serverConfig, currentModelSelection],
  );
  const providerGroups = useMemo(() => groupByProvider(modelOptions), [modelOptions]);
  const threadProviderGroups = useMemo(
    () =>
      resolveThreadProviderGroups({
        providerGroups,
        currentProviderInstanceId: currentModelSelection.instanceId,
        supportsProviderHandoff:
          props.serverConfig?.environment.capabilities.providerHandoff === true,
      }),
    [providerGroups, currentModelSelection.instanceId, props.serverConfig],
  );
  const currentModelOption =
    modelOptions.find(
      (option) =>
        option.selection.instanceId === currentModelSelection.instanceId &&
        option.selection.model === currentModelSelection.model,
    ) ?? null;
  const providerOptionDescriptors = useMemo(
    () =>
      resolveProviderOptionDescriptors({
        capabilities: currentModelOption?.capabilities,
        selections: currentModelSelection.options,
      }),
    [currentModelOption?.capabilities, currentModelSelection.options],
  );
  const modelLabel = currentModelOption?.label ?? currentModelSelection.model;
  const modelIdentity = useMemo(
    () =>
      buildThreadModelIdentity({
        modelLabel,
        providerDriver: currentModelOption?.providerDriver ?? currentModelSelection.instanceId,
        optionDescriptors: providerOptionDescriptors,
      }),
    [
      currentModelOption?.providerDriver,
      currentModelSelection.instanceId,
      modelLabel,
      providerOptionDescriptors,
    ],
  );
  const currentRuntimeMode = displayRuntimeModeForProviderDriver(
    currentModelOption?.providerDriver,
    storedRuntimeMode,
  );
  const settingsSummaryLabel = threadSettingsSummaryLabel({
    modelLabel,
    optionDescriptors: providerOptionDescriptors,
    runtimeMode: currentRuntimeMode,
    interactionMode: currentInteractionMode,
    providerDriver: currentModelOption?.providerDriver ?? null,
  });

  const settingsPicker = useMemo(
    () =>
      buildThreadSettingsPickerModel({
        providerGroups: threadProviderGroups,
        selectedModel: currentModelSelection,
        optionDescriptors: providerOptionDescriptors,
        runtimeMode: currentRuntimeMode,
      }),
    [threadProviderGroups, currentModelSelection, providerOptionDescriptors, currentRuntimeMode],
  );

  const onUpdateModelSelection = props.onUpdateModelSelection;
  const onUpdateRuntimeMode = props.onUpdateRuntimeMode;
  // Display remaps Kimi's "yolo" off other providers without writing back, so
  // switching back to Kimi can still show Yolo. Send remaps at queue time.
  const handleSelectModelOption = useCallback(
    (option: ModelOption) => {
      onUpdateModelSelection(option.selection);
    },
    [onUpdateModelSelection],
  );
  const handleSelectPickerOption = useCallback(
    (id: string, value: string | boolean) => {
      const options = applyProviderOptionSelection(providerOptionDescriptors, { id, value });
      if (options) {
        onUpdateModelSelection({ ...currentModelSelection, options });
      }
    },
    [currentModelSelection, onUpdateModelSelection, providerOptionDescriptors],
  );

  const settingsOwnerId = scopedThreadKey(props.environmentId, props.selectedThread.id);
  const settingsRouteSession = useMemo<ExistingThreadSettingsRouteSession>(
    () => ({
      ownerId: settingsOwnerId,
      providerGroups: threadProviderGroups,
      selectedModel: currentModelSelection,
      onSelectModel: handleSelectModelOption,
      optionDescriptors: providerOptionDescriptors,
      onUpdateOptionSelections: (options) =>
        onUpdateModelSelection({ ...currentModelSelection, options }),
      runtimeMode: currentRuntimeMode,
      onUpdateRuntimeMode,
      initialPage: "home" as const,
      checkpointsThreadRef: {
        environmentId: props.environmentId,
        threadId: props.selectedThread.id,
      },
    }),
    [
      currentModelSelection,
      currentRuntimeMode,
      handleSelectModelOption,
      onUpdateModelSelection,
      onUpdateRuntimeMode,
      props.environmentId,
      props.selectedThread.id,
      providerOptionDescriptors,
      settingsOwnerId,
      threadProviderGroups,
    ],
  );
  const openSettings = useCallback(() => {
    settingsRoutePresentation.present(settingsRouteSession);
    settingsSheetPresentation.open();
  }, [settingsRoutePresentation.present, settingsRouteSession, settingsSheetPresentation.open]);

  useEffect(() => {
    if (settingsSheetPresentation.isActive) {
      settingsRoutePresentation.present(settingsRouteSession, { preservePage: true });
    }
  }, [settingsRoutePresentation.present, settingsRouteSession, settingsSheetPresentation.isActive]);

  useEffect(() => {
    if (!settingsSheetPresentation.isVisible || settingsRoutePresentedRef.current) {
      return;
    }

    settingsRoutePresentedRef.current = true;
    navigation.dispatch(StackActions.push("ThreadSettingsSheet"));
  }, [navigation, settingsSheetPresentation.isVisible]);

  useFocusEffect(
    useCallback(() => {
      if (!settingsRoutePresentedRef.current) {
        return;
      }

      settingsRoutePresentedRef.current = false;
      settingsSheetPresentation.onDismissed();
      settingsRoutePresentation.clear(settingsOwnerId);
    }, [settingsOwnerId, settingsRoutePresentation.clear, settingsSheetPresentation.onDismissed]),
  );

  useEffect(
    () =>
      // UIKit's completion callback for the sheet dismissal, surfaced by the
      // native-stack patch. This is when the queued keyboard restore runs.
      (navigation as unknown as NavigationWithFinishTransitioning).addListener(
        "finishTransitioning",
        settingsSheetPresentation.onStackTransitionsFinished,
      ),
    [navigation, settingsSheetPresentation.onStackTransitionsFinished],
  );

  return (
    <Animated.View
      className="px-4"
      layout={composerLayoutTransition}
      style={{
        paddingTop: isExpanded ? 8 : 6,
        paddingBottom: (props.bottomInset ?? 0) + (isExpanded ? 8 : 6),
      }}
    >
      {/* The backdrop gradient lives on a plain View: Reanimated's Animated.View
          silently drops experimental_backgroundImage on Android, which left this
          strip fully transparent and the feed text legible through the composer. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            experimental_backgroundImage: backdropGradient,
          },
        ]}
      />
      <Animated.View
        className="relative w-full self-center"
        layout={composerLayoutTransition}
        style={{ maxWidth: props.contentMaxWidth }}
      >
        {composerTrigger &&
        (composerMenuItems.length > 0 ||
          (composerTrigger.kind === "path" && pathSearch.isPending)) ? (
          <View className="absolute inset-x-0 bottom-full z-10 mb-2">
            <ComposerCommandPopover
              items={composerMenuItems}
              triggerKind={composerTrigger.kind}
              isLoading={pathSearch.isPending}
              onSelect={handleCommandSelect}
            />
          </View>
        ) : null}

        {connectionStatus ? (
          <ComposerConnectionStatusPill
            status={connectionStatus}
            onPress={props.onReconnectEnvironment}
          />
        ) : null}

        <ComposerSurface
          isDarkMode={isDarkMode}
          animateLayout={composerLayoutTransition !== undefined}
          style={isExpanded ? COMPOSER_EXPANDED_SURFACE_STYLE : COMPOSER_COLLAPSED_SURFACE_STYLE}
        >
          {/* Attachment strip — inside the card, above the text input */}
          {isExpanded ? (
            <Animated.View
              className={props.draftAttachments.length > 0 ? "pb-2.5" : undefined}
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(120)}
            >
              <ComposerAttachmentStrip
                attachments={stripAttachments}
                busy={isSending && props.draftAttachments.length > 0}
                onRemove={props.onRemoveDraftImage}
                onPressImage={onPressImage}
              />
            </Animated.View>
          ) : null}

          <View collapsable={false} className={isExpanded ? undefined : "min-w-0 flex-1"}>
            <ComposerEditor
              ref={inputRef}
              multiline
              value={props.draftMessage}
              skills={selectedProviderStatus?.skills}
              selection={composerSelection}
              onChangeText={props.onChangeDraftMessage}
              onSelectionChange={handleSelectionChange}
              onPasteImages={handlePasteImages}
              placeholder={props.placeholder}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onSubmit={handleSendPress}
              editable={!dictation.active}
              scrollEnabled={isExpanded}
              // Android: collapsed single line centers natively (gravity) in
              // a pill-height box matching the send button; iOS keeps insets.
              singleLineCentered={!isExpanded}
              contentInsetVertical={isExpanded || Platform.OS === "android" ? 0 : 6}
              style={isExpanded ? COMPOSER_EXPANDED_EDITOR_STYLE : COMPOSER_COLLAPSED_EDITOR_STYLE}
              textStyle={editorTextStyle}
            />
          </View>
          {!isExpanded && stripAttachments.length > 0 ? (
            <View className="flex-row gap-1 pl-1">
              {stripAttachments.slice(0, 3).map((image) => (
                <ComposerAttachmentThumb
                  key={image.id}
                  previewUri={image.previewUri}
                  size={30}
                  borderRadius={8}
                  backgroundColor={isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}
                  preparing={isDispatching || image.preparing === true}
                  onPress={
                    isDispatching || image.preparing === true
                      ? undefined
                      : () => onPressImage(image.previewUri)
                  }
                />
              ))}
              {stripAttachments.length > 3 ? (
                <View className="size-[30px] items-center justify-center rounded-lg bg-subtle-strong">
                  <Text className="text-foreground-muted text-2xs font-t3-bold">
                    +{stripAttachments.length - 3}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {!isExpanded ? (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(100)}>
              {showStopAction ? (
                <ControlPill
                  accessibilityLabel="Stop"
                  icon="stop.fill"
                  variant="danger"
                  onPress={props.onStopThread}
                />
              ) : (
                <ControlPill
                  accessibilityLabel={isDispatching ? (dispatchStatus ?? "Sending") : sendLabel}
                  icon="arrow.up"
                  variant="primary"
                  disabled={dictation.active || (!canSend && !isDispatching)}
                  loading={isDispatching}
                  onPress={handleSendPress}
                />
              )}
            </Animated.View>
          ) : null}
        </ComposerSurface>

        {!isExpanded ? (
          <ThreadModelIdentityCaption
            identity={modelIdentity}
            picker={settingsPicker}
            onOpenAdvanced={openSettings}
            onPressFallback={openSettings}
            onSelectModel={handleSelectModelOption}
            onSelectOption={handleSelectPickerOption}
            onSelectRuntime={onUpdateRuntimeMode}
          />
        ) : null}

        {isExpanded ? (
          // Toolbar row — matches draft page layout (expanded only)
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
            <ComposerToolbarRow paddingBottom={8} paddingHorizontal={0} paddingTop={8}>
              <ComposerToolbarScroller
                fadeOpaque={toolbarFadeOpaque}
                fadeTransparent={toolbarFadeTransparent}
                contentPaddingRight={8}
              >
                <ComposerToolbarButton
                  accessibilityLabel="Add attachment"
                  icon="plus"
                  disabled={isDispatching}
                  onPress={() => void handlePickDraftImages()}
                  showChevron={false}
                />
                {supportsVoiceDictation ? (
                  <ComposerToolbarButton
                    accessibilityLabel={
                      dictation.phase === "recording"
                        ? "Stop voice dictation"
                        : dictation.phase === "processing"
                          ? "Finishing voice dictation"
                          : "Start voice dictation"
                    }
                    icon={dictation.phase === "recording" ? "stop.fill" : "mic.fill"}
                    variant={dictation.phase === "recording" ? "danger" : "default"}
                    disabled={
                      dictation.phase === "processing" ||
                      (dictation.phase === "idle" &&
                        (isDispatching || Option.isNone(preparedConnection)))
                    }
                    loading={dictation.phase === "processing"}
                    onPress={() => void dictation.toggle()}
                    showChevron={false}
                  />
                ) : null}
                <ThreadSettingsPickerPopover
                  accessibilityLabel="Model and reasoning settings"
                  model={settingsPicker}
                  onOpenAdvanced={openSettings}
                  onSelectModel={handleSelectModelOption}
                  onSelectOption={handleSelectPickerOption}
                  onSelectRuntime={onUpdateRuntimeMode}
                >
                  <ComposerInlineControl
                    accessibilityLabel="Model and reasoning settings"
                    emphasized
                    iconNode={
                      <ProviderIcon provider={currentModelOption?.providerDriver} size={16} />
                    }
                    label={settingsSummaryLabel}
                    maxWidth={320}
                  />
                </ThreadSettingsPickerPopover>
                {showStopAction ? (
                  <ComposerToolbarButton
                    accessibilityLabel="Stop"
                    icon="stop.fill"
                    variant="danger"
                    onPress={props.onStopThread}
                    showChevron={false}
                  />
                ) : null}
              </ComposerToolbarScroller>
              {/* Long-press queues for the next turn while a turn runs; the
                  menu host is skipped otherwise so send keeps a plain press. */}
              <ControlPillMenu
                actions={sendMenuActions}
                disabled={!showStopAction}
                onPressAction={handleSendMenuAction}
                shouldOpenOnLongPress
              >
                <ComposerToolbarButton
                  accessibilityHint={
                    showStopAction ? "Long press to queue for the next turn" : undefined
                  }
                  accessibilityLabel={isDispatching ? (dispatchStatus ?? "Sending") : sendLabel}
                  icon="arrow.up"
                  variant="primary"
                  disabled={dictation.active || (!canSend && !isDispatching)}
                  loading={isDispatching}
                  onPress={handleSendPress}
                  showChevron={false}
                />
              </ControlPillMenu>
            </ComposerToolbarRow>
          </Animated.View>
        ) : null}

        {dispatchStatus ? <ComposerDispatchStatusLabel label={dispatchStatus} /> : null}

        {/* Queue count */}
        {props.queueCount > 0 ? (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
            <Text className="pt-2 text-xs text-foreground-muted">
              {props.queueCount} queued message{props.queueCount === 1 ? "" : "s"} will send
              automatically.
            </Text>
          </Animated.View>
        ) : null}
      </Animated.View>

      <ImageViewing
        images={previewImageUri ? [{ uri: previewImageUri }] : []}
        imageIndex={0}
        visible={previewImageUri !== null}
        onRequestClose={closePreview}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
      />
    </Animated.View>
  );
});
