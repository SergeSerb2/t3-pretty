import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { applyCreatePullRequestSuffix } from "@t3tools/shared/createPullRequestPrompt";
import { T3CODE_BUILD_FLAVOR } from "@t3tools/shared/connectBranding";
import { StackActions, useNavigation, usePreventRemove } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import {
  KeyboardController,
  KeyboardStickyView,
  useKeyboardState,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useFontFamily } from "../../lib/useFontFamily";

import { MessageId, resolveRuntimeModeForProviderDriver, ThreadId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";

import {
  ComposerEditor,
  type ComposerEditorHandle,
  type ComposerEditorSelection,
} from "../../components/ComposerEditor";
import {
  ComposerActionButton,
  ComposerInlineControl,
  ComposerToolbarRow,
  ComposerToolbarScroller,
} from "../../components/ComposerToolbar";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { ComposerAttachmentButton } from "../../components/ComposerAttachmentButton";
import {
  ComposerAttachmentStrip,
  ComposerDispatchStatusLabel,
  type ComposerAttachmentPreview,
} from "../../components/ComposerAttachmentStrip";
import { waitForComposerSendIndicatorMin } from "../../components/ComposerSendIndicator";
import { composerDispatchStatusLabel } from "../../lib/composerDispatchStatus";
import { ProviderIcon } from "../../components/ProviderIcon";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { GlassSurface } from "../../components/GlassSurface";
import { COMPOSER_LAYOUT_TRANSITION, ComposerSurface } from "./ThreadComposer";
import { ComposerCommandPopover } from "./ComposerCommandPopover";
import { useComposerCommandMenu } from "./use-composer-command-menu";
import { SceneryBackdrop } from "../scenery/SceneryBackdrop";
import { useDailySceneryPhoto, useSceneryChromeActive } from "../scenery/SceneryProvider";
import { UNSPLASH_UTM, type SceneryPhoto } from "../scenery/sceneryLogic";
import {
  applyProviderOptionSelection,
  resolveProviderOptionDescriptors,
} from "../../lib/providerOptions";
import { buildThreadSettingsPickerModel } from "./thread-settings-picker";
import { ThreadSettingsPickerPopover } from "./ThreadSettingsPickerPopover";
import {
  ComposerDictationCancelAction,
  ComposerDictationPrimaryAction,
  ComposerDictationStatus,
  ComposerDictationToolbar,
} from "../voice-input/ComposerDictationControl";
import { useVoiceInputController } from "../voice-input/useVoiceInputController";
import { resolveVoiceComposerPresentation } from "../voice-input/voiceInputPresentation";

import { makeTurnCommandMetadata } from "../../lib/commandMetadata";
import {
  convertPastedImagesToAttachments,
  pickComposerFiles,
  pickComposerMedia,
} from "../../lib/composerImages";
import { useScaledTextRole } from "../settings/appearance/useScaledTextRole";
import {
  clearComposerDraftContent,
  flushComposerDrafts,
  getComposerDraftSnapshot,
  mergeComposerDraftContent,
  restoreComposerDraftSnapshot,
  scheduleUnusedComposerAttachmentCleanup,
  type ComposerDraft,
} from "../../state/use-composer-drafts";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { gitEnvironment } from "../../state/git";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveSelectableModelSelection, type ModelOption } from "../../lib/modelOptions";
import { deriveThreadTitleFromPrompt } from "../../lib/projectThreadStartTurn";
import { markThreadOpenStarted } from "../observability/threadPerformance";
import { armAgentAwarenessLiveActivityForLocalWork } from "../agent-awareness/remoteRegistration";
import {
  clearOptimisticStartingThread,
  registerOptimisticStartingThread,
} from "../../state/optimistic-thread-send";
import { rememberOutgoingMessageDraftAttachments } from "../../state/outgoing-message-previews";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { removeThreadOutboxMessage } from "../../state/thread-outbox-removal";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { useNewTaskFlow } from "./new-task-flow-provider";
import { deriveProjectEmptyState } from "./NewTaskRouteScreen";
import { useWorkspaceState } from "../../state/workspace";
import { resolveProjectThreadCreationBranch } from "./projectThreadCreationValidation";
import { useCreateProjectThread } from "./use-project-actions";
import { resolveDraftProjectSelection } from "./new-task-project-selection";
import {
  resolveNewTaskBranchLabel,
  resolveNewTaskWorkspaceLabel,
} from "./new-task-context-presentation";
import { useIncomingShare } from "../sharing/IncomingShareProvider";
import { selectIncomingShareAttachmentsForServer } from "../sharing/incoming-share-model";
import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";

// KeyboardStickyView memos its animated style against `style` identity.
const DRAFT_COMPOSER_STICKY_STYLE = { position: "absolute", bottom: 0, left: 0, right: 0 } as const;
const DRAFT_COMPOSER_STICKY_OFFSET = { closed: 0, opened: 0 } as const;

function NewTaskWorkspaceIcon(props: {
  readonly workspaceMode: "local" | "worktree";
  readonly worktreePath: string | null;
}) {
  if (props.workspaceMode === "local" && props.worktreePath === null) {
    return (
      <SymbolView
        name="folder"
        size={16}
        tintColorClassName={"accent-icon-muted"}
        type="monochrome"
      />
    );
  }

  return (
    <View className="size-4">
      <SymbolView
        name="folder"
        size={16}
        tintColorClassName={"accent-icon-muted"}
        type="monochrome"
      />
      <View className="absolute -right-1 -bottom-1">
        <SymbolView
          name="arrow.triangle.branch"
          size={9}
          tintColorClassName={"accent-icon-muted"}
          type="monochrome"
        />
      </View>
    </View>
  );
}

function NewTaskDraftFrame(props: {
  readonly children: ReactNode;
  readonly sceneryChrome: boolean;
}) {
  return (
    <View
      className={props.sceneryChrome ? "flex-1 bg-screen" : "flex-1 bg-sheet"}
      collapsable={false}
    >
      {/* No thread exists yet, so this uses Home's photo of the day. */}
      {props.sceneryChrome ? <SceneryBackdrop threadKey={null} /> : null}
      {props.children}
    </View>
  );
}

function NewTaskGlassChip(props: { readonly active: boolean; readonly children: ReactNode }) {
  const chromeFill = useThemeColor("--color-chrome-glass");
  const chromeBorder = useThemeColor("--color-chrome-glass-border");
  if (!props.active) {
    return props.children;
  }

  return (
    <GlassSurface
      chrome="none"
      fallbackStyle={{
        backgroundColor: chromeFill,
        borderColor: chromeBorder,
        borderWidth: StyleSheet.hairlineWidth,
      }}
      style={NEW_TASK_GLASS_CHIP_STYLE}
    >
      {props.children}
    </GlassSurface>
  );
}

function openAttributionUrl(url: string) {
  void Linking.openURL(url).catch(() => undefined);
}

function NewTaskSceneryPlace(props: { readonly photo: SceneryPhoto }) {
  const photographerURL =
    props.photo.photographerProfileURL !== null
      ? `${props.photo.photographerProfileURL}${UNSPLASH_UTM}`
      : `https://unsplash.com/${UNSPLASH_UTM}`;

  return (
    <View className="mt-auto w-full items-center gap-1 px-6 pb-3" testID="new-task-scenery-place">
      <Text className="text-center text-xl font-t3-medium tracking-tight text-foreground">
        {props.photo.name}
      </Text>
      <View className="flex-row flex-wrap items-center justify-center">
        <Text className="text-xs text-foreground-secondary">Photo by </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${props.photo.photographerName} on Unsplash`}
          onPress={() => openAttributionUrl(photographerURL)}
        >
          <Text className="text-xs text-foreground-secondary underline">
            {props.photo.photographerName}
          </Text>
        </Pressable>
        <Text className="text-xs text-foreground-secondary"> on </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Unsplash"
          onPress={() => openAttributionUrl(`https://unsplash.com/${UNSPLASH_UTM}`)}
        >
          <Text className="text-xs text-foreground-secondary underline">Unsplash</Text>
        </Pressable>
      </View>
    </View>
  );
}

const NEW_TASK_GLASS_CHIP_STYLE = {
  borderCurve: "continuous" as const,
  borderRadius: 16,
  overflow: "hidden" as const,
};

export function NewTaskDraftScreen(props: {
  readonly initialProjectRef?: {
    readonly environmentId?: string;
    readonly projectId?: string;
  };
  /** Queued outbox message id when editing an existing pending task. */
  readonly pendingTaskId?: string;
  /** Durable native share inbox item to merge into this project draft. */
  readonly incomingShareId?: string;
}) {
  const projects = useProjects();
  const createProjectThread = useCreateProjectThread();
  const preparePullRequestThread = useAtomCommand(gitEnvironment.preparePullRequestThread, {
    reportFailure: false,
  });
  const flow = useNewTaskFlow();
  const { state: catalogState } = useWorkspaceState();
  const navigation = useNavigation();
  const {
    consumeShare,
    getShare,
    isLoading: isIncomingShareInboxLoading,
    releaseShareReservation,
    reserveShare,
  } = useIncomingShare();
  const insets = useSafeAreaInsets();
  const isKeyboardVisible = useKeyboardState((state) => state.isVisible);
  const controlsBottomPadding = Math.max(insets.bottom, 10);
  const keyboardOpenedOffset = Math.max(0, controlsBottomPadding - 8);
  // Pad from the IME animation instead of KeyboardAvoidingView+automaticOffset.
  // This screen is pushed inside the new-task formSheet; measureInWindow
  // under-lifts by the sheet's top inset and leaves the model/device toolbar
  // behind the keyboard.
  const { height: draftKeyboardTranslateY } = useReanimatedKeyboardAnimation();
  const draftKeyboardVisibleSV = useSharedValue(isKeyboardVisible);
  draftKeyboardVisibleSV.value = isKeyboardVisible;
  const draftKeyboardAvoidStyle = useAnimatedStyle(
    () => ({
      // Matches deriveKeyboardAvoidPadding; inlined so the worklet stays self-contained.
      paddingBottom: draftKeyboardVisibleSV.value ? Math.max(0, -draftKeyboardTranslateY.value) : 0,
    }),
    [],
  );
  const { projectScopes, selectedProject, selectedProjectKey, setProject } = flow;
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const selectedEnvironmentServerConfig = useEnvironmentServerConfig(
    selectedProject?.environmentId ?? null,
  );
  const environmentConnected =
    selectedProject !== null &&
    connectedEnvironments.find(
      (environment) => environment.environmentId === selectedProject.environmentId,
    )?.connectionState === "connected";
  const promptInputRef = useRef<ComposerEditorHandle>(null);
  const [promptSelection, setPromptSelection] = useState<ComposerEditorSelection>(() => ({
    start: flow.prompt.length,
    end: flow.prompt.length,
  }));
  const loadedBranchesProjectKeyRef = useRef<string | null>(null);
  const [pendingPreviews, setPendingPreviews] = useState<ReadonlyArray<ComposerAttachmentPreview>>(
    [],
  );
  const [isPickingAttachments, setIsPickingAttachments] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "ios") {
      return;
    }

    navigation.getParent()?.setOptions({ gestureEnabled: !isKeyboardVisible });
  }, [isKeyboardVisible, navigation]);
  useEffect(() => {
    return () => {
      if (Platform.OS === "ios") {
        navigation.getParent()?.setOptions({ gestureEnabled: true });
      }
    };
  }, [navigation]);
  const newTaskOptionDescriptors = useMemo(
    () =>
      resolveProviderOptionDescriptors({
        capabilities: flow.selectedModelOption?.capabilities,
        selections: flow.selectedModel?.options,
      }),
    [flow.selectedModelOption?.capabilities, flow.selectedModel?.options],
  );
  const settingsPicker = useMemo(
    () =>
      buildThreadSettingsPickerModel({
        providerGroups: flow.providerGroups,
        selectedModel: flow.selectedModel,
        optionDescriptors: newTaskOptionDescriptors,
        runtimeMode: flow.runtimeMode,
      }),
    [flow.providerGroups, flow.selectedModel, flow.runtimeMode, newTaskOptionDescriptors],
  );
  const handleSelectModelOption = useCallback(
    (option: ModelOption) => flow.setSelectedModelKey(option.key, option.selection.options),
    [flow.setSelectedModelKey],
  );
  const handleSelectPickerOption = useCallback(
    (id: string, value: string | boolean) => {
      const options = applyProviderOptionSelection(newTaskOptionDescriptors, { id, value });
      if (options) {
        flow.setSelectedModelOptions(options);
      }
    },
    [flow.setSelectedModelOptions, newTaskOptionDescriptors],
  );
  const [importingShareKey, setImportingShareKey] = useState<string | null>(null);
  const [isCancellingShareImport, setIsCancellingShareImport] = useState(false);
  const [cancelledIncomingShareId, setCancelledIncomingShareId] = useState<string | null>(null);
  const [isReturningToProjectPicker, setIsReturningToProjectPicker] = useState(false);
  const [shareImportAttempt, setShareImportAttempt] = useState(0);
  const startedShareImportKeyRef = useRef<string | null>(null);
  const cancellingShareImportKeyRef = useRef<string | null>(null);
  const shareImportDraftBackupRef = useRef(new Map<string, ComposerDraft>());
  const activeShareImportTokenRef = useRef<symbol | null>(null);
  const shareImportMountedRef = useRef(true);
  const latestDraftKeyRef = useRef(flow.draftKey);
  const latestIncomingShareIdRef = useRef(props.incomingShareId);
  latestDraftKeyRef.current = flow.draftKey;
  latestIncomingShareIdRef.current = props.incomingShareId;
  const isImportingShare = importingShareKey !== null;
  const alertedUnavailableIncomingShareIdRef = useRef<string | null>(null);
  const incomingShare = props.incomingShareId ? getShare(props.incomingShareId) : null;
  const requestedInitialProjectAvailable = Boolean(
    props.initialProjectRef?.environmentId &&
    props.initialProjectRef.projectId &&
    projects.some(
      (project) =>
        project.environmentId === props.initialProjectRef?.environmentId &&
        project.id === props.initialProjectRef?.projectId,
    ),
  );
  const isProjectPickerReturnActive =
    isReturningToProjectPicker && !requestedInitialProjectAvailable;
  const isIncomingShareAwaitingServerConfig = Boolean(
    incomingShare?.attachments.some((attachment) => attachment.type === "file") &&
    selectedEnvironmentServerConfig === null,
  );
  const isIncomingShareTransferPending = Boolean(
    incomingShare &&
    cancelledIncomingShareId !== props.incomingShareId &&
    !isIncomingShareAwaitingServerConfig,
  );
  const isDispatching =
    flow.submitting || pendingPreviews.length > 0 || isPickingAttachments;
  const isComposerInteractionLocked = isIncomingShareTransferPending || isDispatching;
  const composerSelectorsLocked = isComposerInteractionLocked;
  // Also guard while a submit is in flight: an Android back press or iOS
  // Cancel would otherwise abandon the screen while the task still starts.
  const composerMenu = useComposerCommandMenu({
    draftMessage: flow.prompt,
    ownerKey: flow.draftKey,
    environmentId: selectedProject?.environmentId ?? null,
    projectCwd:
      (flow.workspaceMode === "worktree"
        ? selectedProject?.workspaceRoot
        : (flow.selectedWorktreePath ?? selectedProject?.workspaceRoot)) || null,
    selectedProviderStatus: flow.selectedProviderStatus,
    hasThread: false,
    enabled: isComposerFocused && !isComposerInteractionLocked,
    onChangeDraftMessage: flow.setPrompt,
    onUpdateInteractionMode: flow.planModeEnabled ? flow.setInteractionMode : undefined,
  });
  const voiceInput = useVoiceInputController({
    ownerKey: flow.draftKey,
    draftMessage: flow.prompt,
    selection: composerMenu.selection,
    disabled: isIncomingShareTransferPending || isImportingShare || flow.submitting,
    onChangeDraftMessage: flow.setPrompt,
    onChangeSelection: composerMenu.onSelectionChange,
  });
  const voicePresentation = resolveVoiceComposerPresentation(
    voiceInput.state,
    voiceInput.elapsedSeconds,
  );
  const isVoiceInputPresented = voicePresentation.statusLabel !== null;
  usePreventRemove(
    (isIncomingShareTransferPending && !isProjectPickerReturnActive) ||
      isCancellingShareImport ||
      flow.submitting,
    () => undefined,
  );
  const hasImportedIncomingShare = Boolean(
    props.incomingShareId &&
    flow.draftKey &&
    getComposerDraftSnapshot(flow.draftKey).importedShareIds?.includes(props.incomingShareId),
  );
  const isIncomingShareUnavailable = Boolean(
    props.incomingShareId &&
    !isIncomingShareInboxLoading &&
    !incomingShare &&
    !hasImportedIncomingShare,
  );
  const isIncomingShareReady =
    !props.incomingShareId ||
    (hasImportedIncomingShare && !incomingShare) ||
    isIncomingShareUnavailable;
  const appliedInitialProjectKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (cancelledIncomingShareId === props.incomingShareId) {
      navigation.goBack();
    }
  }, [cancelledIncomingShareId, navigation, props.incomingShareId]);
  useEffect(() => {
    if (!isReturningToProjectPicker) {
      return;
    }
    if (requestedInitialProjectAvailable) {
      setIsReturningToProjectPicker(false);
      return;
    }
    // Let usePreventRemove commit its disabled state before replacing this
    // route, otherwise the transfer guard can swallow the fallback action.
    const frame = requestAnimationFrame(() => {
      navigation.dispatch(
        StackActions.replace("NewTask", { incomingShareId: props.incomingShareId }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [
    isReturningToProjectPicker,
    navigation,
    props.incomingShareId,
    requestedInitialProjectAvailable,
  ]);
  useEffect(() => {
    if (!shareImportMountedRef.current) {
      startedShareImportKeyRef.current = null;
    }
    shareImportMountedRef.current = true;
    return () => {
      appliedInitialProjectKeyRef.current = null;
      shareImportMountedRef.current = false;
      activeShareImportTokenRef.current = null;
      cancellingShareImportKeyRef.current = null;
    };
  }, []);

  const { beginEditingPendingTask, cancelEditingPendingTask, editingPendingTask } = flow;
  const attemptedPendingTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!props.pendingTaskId || editingPendingTask?.messageId === props.pendingTaskId) {
      return;
    }
    // Attempt each pending task once: after it is delivered or deleted the
    // editing session legitimately ends, and re-running must not navigate.
    if (attemptedPendingTaskIdRef.current === props.pendingTaskId) {
      return;
    }
    attemptedPendingTaskIdRef.current = props.pendingTaskId;
    if (!beginEditingPendingTask(props.pendingTaskId)) {
      // The queued task no longer exists (sent or deleted before opening).
      navigation.dispatch(StackActions.replace("NewTask"));
    }
  }, [beginEditingPendingTask, editingPendingTask?.messageId, navigation, props.pendingTaskId]);

  useEffect(() => {
    if (!props.pendingTaskId) return;
    return () => {
      // Allow a later navigation for the same pending task to re-hydrate it.
      attemptedPendingTaskIdRef.current = null;
      cancelEditingPendingTask();
    };
  }, [props.pendingTaskId, cancelEditingPendingTask]);

  const sceneryColorScheme = useColorScheme();
  const uniwindTheme = useUniwindTheme();
  const foregroundColor = uniwindTheme["--color-foreground"];
  const projectUnderlineColor = uniwindTheme["--color-foreground-muted"];
  const regularFontFamily = useFontFamily("regular");
  const bodyText = useScaledTextRole("body");
  const sceneryChrome = useSceneryChromeActive();
  const dailyPhoto = useDailySceneryPhoto();
  // Fade into the composer card, not the sheet: the toolbar lives inside the glass surface.
  const toolbarSurface = String(uniwindTheme["--color-card"]);
  const toolbarFadeOpaque = themeColorWithAlpha(toolbarSurface, 0.95);
  const toolbarFadeTransparent = themeColorWithAlpha(toolbarSurface, 0);

  // A new navigation to this mounted screen delivers a fresh initialProjectRef
  // reference — treat it as a new request and let it apply again.
  const lastInitialProjectRefRef = useRef(props.initialProjectRef);

  useEffect(() => {
    // Pending-task editing owns project selection (and must not fall through
    // to the replace("NewTask") fallback while its hydration is in flight).
    if (props.pendingTaskId) {
      return;
    }
    if (lastInitialProjectRefRef.current !== props.initialProjectRef) {
      lastInitialProjectRefRef.current = props.initialProjectRef;
      appliedInitialProjectKeyRef.current = null;
    }
    const initialEnvironmentId = props.initialProjectRef?.environmentId;
    const initialProjectId = props.initialProjectRef?.projectId;
    if (initialEnvironmentId && initialProjectId) {
      const directProject =
        projects.find(
          (project) =>
            project.environmentId === initialEnvironmentId && project.id === initialProjectId,
        ) ?? null;

      if (directProject) {
        // Apply the route's project once. Re-applying on every change would
        // instantly revert environment/project switches made in the picker.
        const directProjectKey = `${directProject.environmentId}:${directProject.id}`;
        if (appliedInitialProjectKeyRef.current === directProjectKey) {
          return;
        }
        appliedInitialProjectKeyRef.current = directProjectKey;
        if (
          selectedProject?.environmentId === directProject.environmentId &&
          selectedProject.id === directProject.id
        ) {
          return;
        }
        setProject(directProject);
        return;
      }

      if (projects.length > 0) {
        // Never fall through to the flow provider's temporary first-project
        // default. Return to the picker with the share id intact so the user
        // can choose an available destination.
        setIsReturningToProjectPicker(true);
      }
      return;
    }

    const selection = resolveDraftProjectSelection(selectedProjectKey, projects, projectScopes);
    if (selection.kind === "preserve") {
      return;
    }
    if (selection.kind === "select") {
      setProject(selection.project);
      return;
    }

    navigation.dispatch(StackActions.replace("NewTask"));
  }, [
    projectScopes,
    projects,
    props.initialProjectRef,
    props.incomingShareId,
    props.pendingTaskId,
    navigation,
    selectedProject,
    selectedProjectKey,
    setProject,
  ]);

  useEffect(() => {
    if (!selectedProject) {
      loadedBranchesProjectKeyRef.current = null;
      return;
    }
    const projectKey = `${selectedProject.environmentId}:${selectedProject.id}`;
    if (loadedBranchesProjectKeyRef.current === projectKey) {
      return;
    }
    loadedBranchesProjectKeyRef.current = projectKey;
    flow.loadBranches();
  }, [flow.loadBranches, selectedProject]);

  useEffect(() => {
    const shareId = props.incomingShareId;
    const draftKey = flow.draftKey;
    const destinationProject = selectedProject;
    const initialEnvironmentId = props.initialProjectRef?.environmentId;
    const initialProjectId = props.initialProjectRef?.projectId;
    const selectedProjectMatchesRoute =
      !initialEnvironmentId ||
      !initialProjectId ||
      (destinationProject?.environmentId === initialEnvironmentId &&
        destinationProject.id === initialProjectId);
    if (
      !shareId ||
      !draftKey ||
      !destinationProject ||
      !selectedProjectMatchesRoute ||
      cancelledIncomingShareId === shareId
    ) {
      return;
    }
    const importKey = `${shareId}:${draftKey}`;
    if (
      startedShareImportKeyRef.current === importKey ||
      cancellingShareImportKeyRef.current === importKey
    ) {
      return;
    }

    if (!incomingShare) {
      if (isIncomingShareUnavailable && alertedUnavailableIncomingShareIdRef.current !== shareId) {
        alertedUnavailableIncomingShareIdRef.current = shareId;
        Alert.alert(
          "Shared content unavailable",
          "The shared content is no longer in the inbox. You can continue editing this task draft.",
        );
      }
      return;
    }

    if (
      incomingShare.attachments.some((attachment) => attachment.type === "file") &&
      selectedEnvironmentServerConfig === null
    ) {
      return;
    }

    if (alertedUnavailableIncomingShareIdRef.current === shareId) {
      alertedUnavailableIncomingShareIdRef.current = null;
    }
    startedShareImportKeyRef.current = importKey;
    const draftBackup =
      shareImportDraftBackupRef.current.get(importKey) ?? getComposerDraftSnapshot(draftKey);
    shareImportDraftBackupRef.current.set(importKey, draftBackup);
    const importToken = Symbol(importKey);
    let didReserveShare = false;
    let didConsumeShare = false;
    let needsDraftRestore = false;
    activeShareImportTokenRef.current = importToken;
    setImportingShareKey(importKey);
    void (async () => {
      await reserveShare(shareId, {
        environmentId: String(destinationProject.environmentId),
        projectId: String(destinationProject.id),
      });
      didReserveShare = true;
      if (
        !shareImportMountedRef.current ||
        activeShareImportTokenRef.current !== importToken ||
        latestDraftKeyRef.current !== draftKey ||
        latestIncomingShareIdRef.current !== shareId
      ) {
        return;
      }
      const selectedAttachments = selectIncomingShareAttachmentsForServer({
        attachments: incomingShare.attachments,
        serverConfig: appAtomRegistry.get(
          serverEnvironment.configValueAtom(destinationProject.environmentId),
        ),
      });
      if (selectedAttachments.status === "pending") {
        throw new Error("Server attachment support is still loading.");
      }
      needsDraftRestore = true;
      const { skippedAttachmentCount } = await mergeComposerDraftContent(draftKey, {
        text: incomingShare.text,
        attachments: selectedAttachments.attachments,
        sourceShareId: shareId,
      });
      if (
        !shareImportMountedRef.current ||
        activeShareImportTokenRef.current !== importToken ||
        latestDraftKeyRef.current !== draftKey ||
        latestIncomingShareIdRef.current !== shareId
      ) {
        // The durable reservation makes an interrupted transfer resume only
        // in this project instead of copying into a second project draft.
        return;
      }
      await consumeShare(shareId);
      didConsumeShare = true;
      // The consumed inbox draft was the last owner of files that never made
      // it into the composer draft (unsupported server, oversize, limit
      // skips). Release them before any early return: an unmount or a
      // superseding import must not leak them, and the sweep re-checks
      // ownership so it cannot delete a file another draft picked up.
      const retainedAttachmentIds = new Set(
        getComposerDraftSnapshot(draftKey).attachments.map((attachment) => attachment.id),
      );
      scheduleUnusedComposerAttachmentCleanup(
        incomingShare.attachments.filter((attachment) => !retainedAttachmentIds.has(attachment.id)),
      );
      if (!shareImportMountedRef.current || activeShareImportTokenRef.current !== importToken) {
        return;
      }
      const warnings = [...incomingShare.warnings, ...selectedAttachments.warnings];
      if (skippedAttachmentCount > 0) {
        warnings.push(
          `${skippedAttachmentCount} shared file${skippedAttachmentCount === 1 ? " was" : "s were"} skipped because this draft reached the attachment limit.`,
        );
      }
      if (warnings.length > 0) {
        Alert.alert("Some shared content was skipped", warnings.join("\n"));
      }
      shareImportDraftBackupRef.current.delete(importKey);
    })()
      .catch((error) => {
        if (!shareImportMountedRef.current || activeShareImportTokenRef.current !== importToken) {
          return;
        }
        Alert.alert(
          "Could not import shared content",
          error instanceof Error ? error.message : "The shared content could not be saved.",
          [
            {
              text: "Cancel import",
              style: "cancel",
              onPress: () => {
                const cancelImport = async (): Promise<void> => {
                  if (!shareImportMountedRef.current) {
                    return;
                  }
                  // Latch synchronously before restoring the draft. The
                  // restore publishes atom state and can re-run the import
                  // effect before React commits the cancelling state update.
                  cancellingShareImportKeyRef.current = importKey;
                  setIsCancellingShareImport(true);
                  try {
                    if (needsDraftRestore) {
                      // The restore drops the share's merged-in attachments
                      // from the draft. Sweep them only when the inbox entry
                      // was consumed: before that, the inbox still references
                      // these files and must keep them for a later import.
                      const mergedAttachments = getComposerDraftSnapshot(draftKey).attachments;
                      await restoreComposerDraftSnapshot(draftKey, draftBackup);
                      needsDraftRestore = false;
                      if (didConsumeShare) {
                        scheduleUnusedComposerAttachmentCleanup(mergedAttachments);
                      }
                    }
                    if (didReserveShare) {
                      await releaseShareReservation(shareId, {
                        environmentId: String(destinationProject.environmentId),
                        projectId: String(destinationProject.id),
                      });
                    }
                    shareImportDraftBackupRef.current.delete(importKey);
                    if (shareImportMountedRef.current) {
                      setIsCancellingShareImport(false);
                      setCancelledIncomingShareId(shareId);
                    }
                  } catch (cancelError) {
                    if (!shareImportMountedRef.current) {
                      return;
                    }
                    Alert.alert(
                      "Could not cancel import",
                      cancelError instanceof Error
                        ? cancelError.message
                        : "The shared content could not be restored safely.",
                      [
                        {
                          text: "Retry import",
                          onPress: () => {
                            cancellingShareImportKeyRef.current = null;
                            setIsCancellingShareImport(false);
                            setShareImportAttempt((attempt) => attempt + 1);
                          },
                        },
                        {
                          text: "Retry cancel",
                          onPress: () => void cancelImport(),
                        },
                      ],
                      { cancelable: false },
                    );
                  }
                };
                void cancelImport();
              },
            },
            {
              text: "Retry",
              onPress: () => setShareImportAttempt((attempt) => attempt + 1),
            },
          ],
          { cancelable: false },
        );
      })
      .finally(() => {
        if (startedShareImportKeyRef.current === importKey) {
          // Every terminal path, including an invalidated operation, must
          // release the synchronous start latch so this transfer can retry.
          startedShareImportKeyRef.current = null;
        }
        if (shareImportMountedRef.current && activeShareImportTokenRef.current === importToken) {
          activeShareImportTokenRef.current = null;
          setImportingShareKey(null);
        }
      });
  }, [
    consumeShare,
    cancelledIncomingShareId,
    flow.draftKey,
    hasImportedIncomingShare,
    incomingShare,
    isIncomingShareInboxLoading,
    isIncomingShareUnavailable,
    props.incomingShareId,
    props.initialProjectRef?.environmentId,
    props.initialProjectRef?.projectId,
    releaseShareReservation,
    reserveShare,
    selectedEnvironmentServerConfig,
    selectedProject,
    shareImportAttempt,
  ]);

  const selectedEnvironmentLabel =
    flow.environments.find(
      (environment) => environment.environmentId === flow.selectedEnvironmentId,
    )?.environmentLabel ?? "Environment";
  const availableCurrentBranchName =
    flow.availableBranches.find((branch) => branch.current)?.name ??
    flow.availableBranches.find((branch) => branch.isDefault)?.name ??
    null;
  const selectedBranchName = resolveProjectThreadCreationBranch({
    workspaceMode: flow.workspaceMode,
    selectedBranch:
      flow.selectedBranchName ??
      (flow.workspaceMode === "worktree" ? availableCurrentBranchName : null),
    currentCheckoutBranch: flow.currentCheckoutBranchName,
  });
  const selectedBranchLabel = resolveNewTaskBranchLabel({
    branchName: selectedBranchName,
    startFromOrigin: flow.startFromOrigin,
    workspaceMode: flow.workspaceMode,
  });
  const workspaceLabel = resolveNewTaskWorkspaceLabel({
    workspaceMode: flow.workspaceMode,
    worktreePath: flow.selectedWorktreePath,
  });
  const showBranchLoading = flow.branchesLoading && flow.availableBranches.length === 0;

  async function handlePickMedia(): Promise<void> {
    if (isComposerInteractionLocked || voiceInput.isBusy) {
      return;
    }
    setIsPickingAttachments(true);
    try {
      const capabilities = selectedEnvironmentServerConfig?.environment.capabilities;
      const result = await pickComposerMedia({
        existingCount: flow.attachments.length,
        maxVideoBytes:
          capabilities?.attachmentUploads === true
            ? capabilities.fileAttachments?.maxUploadBytes
            : undefined,
      });
      const rejectedCount =
        result.attachments.length > 0 ? flow.appendAttachments(result.attachments) : 0;
      const problems = [
        ...(result.error ? [result.error] : []),
        ...(rejectedCount > 0
          ? [`You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments per message.`]
          : []),
      ];
      if (problems.length > 0) {
        Alert.alert("Could not attach photo or video", problems.join("\n\n"));
      }
    } finally {
      setIsPickingAttachments(false);
    }
  }

  async function handlePickFiles(): Promise<void> {
    if (isComposerInteractionLocked || voiceInput.isBusy) {
      return;
    }
    const maxBytes =
      selectedEnvironmentServerConfig?.environment.capabilities.fileAttachments?.maxUploadBytes;
    if (maxBytes === undefined) {
      Alert.alert("File attachments are not available on this server.");
      return;
    }
    setIsPickingAttachments(true);
    try {
      const result = await pickComposerFiles({
        existingCount: flow.attachments.length,
        maxBytes,
      });
      const rejectedCount = result.files.length > 0 ? flow.appendAttachments(result.files) : 0;
      // The picker error and the live-cap rejection can both happen in one
      // pick; report both in a single alert.
      const problems = [
        ...(result.error ? [result.error] : []),
        ...(rejectedCount > 0
          ? [`You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`]
          : []),
      ];
      if (problems.length > 0) {
        Alert.alert("Could not attach file", problems.join("\n\n"));
      }
    } finally {
      setIsPickingAttachments(false);
    }
  }

  const handleNativePasteImages = useCallback(
    async (uris: ReadonlyArray<string>) => {
      if (uris.length === 0) {
        return;
      }
      setPendingPreviews(
        uris.map((uri, index) => ({
          id: `pending:${index}:${uri}`,
          previewUri: uri,
          preparing: true,
        })),
      );
      try {
        const result = await convertPastedImagesToAttachments({
          uris,
          existingCount: flow.attachments.length,
        });
        if (result.images.length > 0) {
          flow.appendAttachments(result.images);
        }
        if (result.error) {
          Alert.alert("Could not attach image", result.error);
        }
      } catch (error) {
        console.error("[native paste] error converting images", error);
      } finally {
        setPendingPreviews([]);
      }
    },
    [flow],
  );

  // Resolved by the flow provider against the workspace mode currently shown
  // in the pill (with any draft-scoped override), so the toggle always
  // reflects what the next Start tap will send.
  const autoCreatePullRequest = flow.autoCreatePullRequest;
  const toggleAutoCreatePullRequest = () => {
    flow.setAutoCreatePullRequest(!autoCreatePullRequest);
  };

  async function handleStart(): Promise<void> {
    if (voiceInput.blocksSubmission) return;
    const selectedProject = flow.selectedProject;
    const draftKey = flow.draftKey;
    if (!selectedProject || !draftKey) {
      return;
    }
    const draft = getComposerDraftSnapshot(draftKey);
    // Snapshot read keeps just-typed selector state; the availability gate
    // still applies so a stored selection on a disabled provider falls back
    // to the flow's resolved model.
    const modelSelection =
      resolveSelectableModelSelection(
        selectedEnvironmentServerConfig,
        draft.modelSelection ?? null,
      ) ?? flow.selectedModel;
    const pullRequestReference = draft.pullRequestReference?.trim() ?? "";
    let workspaceMode = draft.workspaceSelection?.mode ?? flow.workspaceMode;
    let selectedBranchName = draft.workspaceSelection?.branch ?? flow.selectedBranchName;
    let selectedWorktreePath = draft.workspaceSelection?.worktreePath ?? flow.selectedWorktreePath;
    let startFromOrigin = draft.workspaceSelection?.startFromOrigin ?? flow.startFromOrigin;
    const runtimeMode = resolveRuntimeModeForProviderDriver(
      selectedEnvironmentServerConfig?.providers.find(
        (provider) => provider.instanceId === modelSelection?.instanceId,
      )?.driver,
      draft.runtimeMode ?? flow.runtimeMode,
    );
    const interactionMode = flow.planModeEnabled
      ? (draft.interactionMode ?? flow.interactionMode)
      : "default";
    const initialMessageText = draft.text.trim();

    if (
      !modelSelection ||
      initialMessageText.length === 0 ||
      flow.submitting ||
      pendingPreviews.length > 0 ||
      !flow.autoCreatePullRequestSettled ||
      (pullRequestReference.length === 0 && workspaceMode === "worktree" && !selectedBranchName)
    ) {
      return;
    }
    // A failed-send restore can leave the draft over the cap on purpose (it
    // never drops the user's files); starting anyway would upload everything
    // and have the server reject the turn.
    if (draft.attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      Alert.alert(
        "Too many attachments",
        `Remove attachments until there are at most ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}.`,
      );
      return;
    }

    // The composer is a custom native text view, so RN Keyboard.dismiss()
    // would miss it. Resign first responder through the library so its
    // visibility flag (which gates draft keyboard padding below) updates.
    promptInputRef.current?.blur();
    void KeyboardController.dismiss();

    const editingPendingTask = flow.editingPendingTask;

    if (!environmentConnected) {
      if (pullRequestReference.length > 0) {
        Alert.alert(
          "Could not prepare the pull request checkout",
          "Reconnect to this environment, then start the task so the branch can be checked out first.",
        );
        return;
      }
      // Offline: park the task in the outbox; the drain sends it when the
      // environment reconnects. Editing an existing pending task re-queues it
      // under its original identifiers.
      const metadata = editingPendingTask
        ? {
            threadId: editingPendingTask.threadId,
            commandId: editingPendingTask.commandId,
            messageId: editingPendingTask.messageId,
            createdAt: editingPendingTask.createdAt,
          }
        : makeTurnCommandMetadata();
      const message = flow.buildPendingTaskMessage(metadata);
      if (!message) {
        return;
      }
      const queuedAt = Date.now();
      flow.setSubmitting(true);
      try {
        await enqueueThreadOutboxMessage(message);
        await waitForComposerSendIndicatorMin(queuedAt);
      } catch (error) {
        Alert.alert(
          "Could not queue task",
          error instanceof Error ? error.message : "The task could not be saved to the outbox.",
        );
        return;
      } finally {
        flow.setSubmitting(false);
      }
      if (editingPendingTask) {
        flow.finishEditingPendingTask();
      } else {
        // Drop draft-local model/workspace selections with the content. The
        // next task re-resolves project defaults before sticky app defaults.
        clearComposerDraftContent(draftKey, {
          clearModelSelection: true,
          clearWorkspaceSelection: true,
        });
      }
      navigation.getParent()?.goBack();
      return;
    }

    flow.setSubmitting(true);
    // Arm the lock-screen card before the async thread creation: backgrounding
    // the app right after tapping submit would otherwise reject the foreground
    // -only Activity start. If creation fails, the token registration's replay
    // finds no work and ends the card within seconds.
    armAgentAwarenessLiveActivityForLocalWork({
      environmentId: selectedProject.environmentId,
      threadTitle: deriveThreadTitleFromPrompt(initialMessageText),
      projectTitle: selectedProject.title,
    });
    const turnMetadata = editingPendingTask
      ? {
          threadId: editingPendingTask.threadId,
          commandId: editingPendingTask.commandId,
          messageId: editingPendingTask.messageId,
          createdAt: editingPendingTask.createdAt,
        }
      : makeTurnCommandMetadata();

    let stalePullRequestCheckout = false;
    if (pullRequestReference.length > 0) {
      const prepared = await preparePullRequestThread({
        environmentId: selectedProject.environmentId,
        input: {
          cwd: selectedProject.workspaceRoot,
          reference: pullRequestReference,
          mode: "worktree",
          threadId: ThreadId.make(turnMetadata.threadId),
        },
      });
      if (AsyncResult.isFailure(prepared)) {
        flow.setSubmitting(false);
        if (!isAtomCommandInterrupted(prepared)) {
          const error = squashAtomCommandFailure(prepared);
          Alert.alert(
            "Could not prepare the pull request checkout",
            error instanceof Error
              ? error.message
              : "The branch could not be checked out. Try again from the project.",
          );
        }
        return;
      }
      if (prepared.value.worktreePath === null) {
        flow.setSubmitting(false);
        Alert.alert(
          "Could not prepare the pull request checkout",
          "The environment did not return a worktree for this pull request.",
        );
        return;
      }
      // The worktree already exists; create the thread in local mode pointed at
      // that path so startTurn does not mint another worktree.
      workspaceMode = "local";
      selectedBranchName = prepared.value.branch;
      selectedWorktreePath = prepared.value.worktreePath;
      startFromOrigin = false;
      stalePullRequestCheckout = !prepared.value.isOnPullRequestHead;
    }

    const creationBranch = resolveProjectThreadCreationBranch({
      workspaceMode,
      selectedBranch: selectedBranchName,
      currentCheckoutBranch:
        pullRequestReference.length > 0 ? selectedBranchName : flow.currentCheckoutBranchName,
    });
    const initialMessageTextForSend = applyCreatePullRequestSuffix({
      text: initialMessageText,
      autoCreatePullRequest,
      threadHasStarted: false,
      model: modelSelection.model,
    });
    const threadId = ThreadId.make(turnMetadata.threadId);
    const messageId = MessageId.make(turnMetadata.messageId);
    const fallbackQueuedMessage = flow.buildPendingTaskMessage(turnMetadata);

    // Open the thread immediately and show thinking while startTurn talks to
    // the remote machine. The create RPC keeps running after this screen
    // unmounts.
    registerOptimisticStartingThread({
      environmentId: selectedProject.environmentId,
      threadId,
      projectId: selectedProject.id,
      title: deriveThreadTitleFromPrompt(initialMessageText),
      modelSelection,
      runtimeMode,
      interactionMode,
      branch: creationBranch,
      worktreePath: workspaceMode === "worktree" ? null : selectedWorktreePath,
      enabledSkillIds: draft.enabledSkillIds,
      createdAt: turnMetadata.createdAt,
      sendStartedAt: new Date().toISOString(),
      message: {
        messageId,
        text: initialMessageTextForSend,
        createdAt: turnMetadata.createdAt,
      },
      onAttachmentsUploaded: async (attachments) => {
        flow.replaceAttachments(attachments);
        await flushComposerDrafts();
      },
    });
    rememberOutgoingMessageDraftAttachments(messageId, draft.attachments);

    if (editingPendingTask) {
      try {
        await removeThreadOutboxMessage(editingPendingTask);
      } catch (error) {
        console.warn("[new-task] failed to remove delivered pending task", error);
      }
      flow.finishEditingPendingTask();
    } else {
      clearComposerDraftContent(draftKey, {
        clearModelSelection: true,
        clearWorkspaceSelection: true,
      });
    }

    markThreadOpenStarted(String(selectedProject.environmentId), String(threadId));
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: String(selectedProject.environmentId),
        threadId: String(threadId),
      }),
    );

    const result = await createProjectThread({
      project: selectedProject,
      modelSelection,
      envMode: workspaceMode,
      branch: creationBranch,
      worktreePath: workspaceMode === "worktree" ? null : selectedWorktreePath,
      startFromOrigin,
      runtimeMode,
      interactionMode,
      enabledSkillIds: draft.enabledSkillIds ?? [],
      initialMessageText: initialMessageTextForSend,
      initialAttachments: draft.attachments,
      turnMetadata,
    });

    if (result._tag === "Failure") {
      clearOptimisticStartingThread(selectedProject.environmentId, threadId);
      if (fallbackQueuedMessage) {
        try {
          await enqueueThreadOutboxMessage(fallbackQueuedMessage);
        } catch (error) {
          console.warn("[new-task] failed to requeue a rejected starting task", error);
        }
      }
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        Alert.alert(
          pullRequestReference.length > 0
            ? "Checked out, but the thread could not start"
            : "Could not start task",
          pullRequestReference.length > 0
            ? `The checkout is ready on \`${selectedBranchName}\`. Start a task from the project and point it at that branch.`
            : error instanceof Error
              ? error.message
              : "The task could not be started.",
        );
      }
      return;
    }

    if (stalePullRequestCheckout) {
      Alert.alert(
        "Checked out, but not on the latest commits",
        "The checkout could not be moved onto the pull request's latest commits, so the code there is older than the pull request. Uncommitted work or local commits keep it where it is.",
      );
    }
  }

  if (!selectedProject) {
    // No project can mean "still loading" or a real dead end (no environments,
    // environment offline, no projects) — a bare spinner would lie forever.
    const projectEmptyState = deriveProjectEmptyState(catalogState);
    return (
      <NewTaskDraftFrame sceneryChrome={sceneryChrome}>
        {Platform.OS === "android" ? (
          <>
            <NativeStackScreenOptions options={{ headerShown: false }} />
            <AndroidScreenHeader title="New Thread" onBack={() => navigation.goBack()} />
          </>
        ) : (
          <NativeStackScreenOptions
            options={{ title: projectEmptyState.loading ? "Loading task" : "New task" }}
          />
        )}
        <View className="flex-1 items-center justify-center">
          {projectEmptyState.loading ? (
            <ActivityIndicator />
          ) : (
            <EmptyState
              title={projectEmptyState.title}
              detail={projectEmptyState.detail}
              actionLabel={catalogState.hasReadyEnvironment ? "Add new project" : "Add environment"}
              onAction={() =>
                catalogState.hasReadyEnvironment
                  ? navigation.dispatch(StackActions.push("AddProject"))
                  : navigation.navigate("ConnectionsNew")
              }
              variant="plain"
            />
          )}
        </View>
      </NewTaskDraftFrame>
    );
  }

  const isAndroid = Platform.OS === "android";
  const isDarkMode = sceneryColorScheme === "dark";
  const attachedUris = new Set(flow.attachments.map((image) => image.previewUri));
  const stripAttachments = [
    ...flow.attachments,
    ...pendingPreviews.filter((preview) => !attachedUris.has(preview.previewUri)),
  ];
  const dispatchStatus = composerDispatchStatusLabel(
    pendingPreviews.length > 0
      ? { kind: "preparing-images", count: pendingPreviews.length }
      : flow.submitting
        ? {
            kind: "sending",
            creatingThread: true,
            connected: environmentConnected,
          }
        : { kind: "idle" },
  );
  const preparedConnection = usePreparedConnection(selectedProject?.environmentId ?? null);
  const supportsVoiceDictation =
    T3CODE_BUILD_FLAVOR === "internal" &&
    selectedEnvironmentServerConfig?.environment.capabilities.voiceDictation === true;
  const reportDictationError = useCallback((message: string) => {
    Alert.alert("Voice dictation", message);
  }, []);
  const dictation = useNativeDictation({
    enabled:
      supportsVoiceDictation &&
      Option.isSome(preparedConnection) &&
      !isIncomingShareTransferPending &&
      !isDispatching,
    prepared: Option.getOrNull(preparedConnection),
    value: flow.prompt,
    cursor: promptSelection.end,
    onChangeValue: flow.setPrompt,
    onChangeCursor: (cursor) => {
      const selection = { start: cursor, end: cursor };
      setPromptSelection(selection);
      composerMenu.onSelectionChange(selection);
    },
    reportError: reportDictationError,
  });
  useEffect(() => {
    const end = flow.prompt.length;
    setPromptSelection({
      start: Math.min(composerMenu.selection.start, end),
      end: Math.min(composerMenu.selection.end, end),
    });
  }, [composerMenu.selection.end, composerMenu.selection.start, flow.prompt.length]);
  const canStart =
    Boolean(flow.selectedProject) &&
    Boolean(flow.selectedModel) &&
    flow.prompt.trim().length > 0 &&
    isIncomingShareReady &&
    !isImportingShare &&
    !isDispatching &&
    !dictation.active &&
    !voiceInput.blocksSubmission &&
    // The auto-PR choice must be settled (draft override or hydrated
    // preferences) so a cold-start send cannot race the stored setting.
    flow.autoCreatePullRequestSettled &&
    // Pull-request hand-offs prepare their own checkout on Start, so they do
    // not need the ordinary worktree branch pick to be complete.
    (Boolean(flow.draftKey && getComposerDraftSnapshot(flow.draftKey).pullRequestReference) ||
      !(flow.workspaceMode === "worktree" && !flow.selectedBranchName));
  const promptEditor = (
    <ComposerEditor
      ref={promptInputRef}
      // The context-first screen intentionally opens with the keyboard closed.
      autoFocus={false}
      editable={!isIncomingShareTransferPending && !isDispatching && !dictation.active}
      readOnly={voiceInput.freezesEditor}
      multiline
      scrollEnabled
      value={flow.prompt}
      selection={promptSelection}
      skills={flow.selectedProviderStatus?.skills ?? []}
      onChangeText={flow.setPrompt}
      onSelectionChange={(selection) => {
        setPromptSelection(selection);
        composerMenu.onSelectionChange(selection);
      }}
      onFocus={() => setIsComposerFocused(true)}
      onBlur={() => setIsComposerFocused(false)}
      onPasteImages={(uris) => void handleNativePasteImages(uris)}
      placeholder="Ask anything…"
      singleLineCentered={false}
      contentInsetVertical={0}
      style={{
        minHeight: 72,
        maxHeight: 160,
        paddingVertical: 4,
      }}
      textStyle={{ ...bodyText, color: foregroundColor, fontFamily: regularFontFamily }}
    />
  );

  const closeNewTask = () => {
    void KeyboardController.dismiss({ animated: true });
    const parentNavigation = navigation.getParent();
    if (parentNavigation) {
      parentNavigation.goBack();
      return;
    }
    navigation.goBack();
  };
  const chooseProject = () => {
    if (composerSelectorsLocked) {
      return;
    }
    promptInputRef.current?.blur();
    void KeyboardController.dismiss({ animated: true });
    navigation.dispatch(StackActions.push("NewTask", { incomingShareId: props.incomingShareId }));
  };
  const openContextPicker = (
    routeName: "NewTaskBranch" | "NewTaskEnvironment" | "NewTaskSkills",
  ) => {
    if (composerSelectorsLocked) {
      return;
    }
    promptInputRef.current?.blur();
    void KeyboardController.dismiss({ animated: true });
    navigation.dispatch(StackActions.push(routeName));
  };

  const hero = (
    <View className="items-center gap-6 px-6" testID="new-task-hero">
      <View className="w-full items-center gap-1.5">
        <Text className="text-center text-2xl font-t3-medium tracking-tight text-foreground">
          What should we build
        </Text>
        <View className="max-w-full flex-row items-center justify-center">
          <Text className="text-2xl font-t3-medium tracking-tight text-foreground">in </Text>
          <Pressable
            accessibilityHint="Opens the project picker"
            accessibilityLabel={`Change project from ${selectedProject.title}`}
            accessibilityRole="button"
            disabled={composerSelectorsLocked}
            onPress={chooseProject}
            className="min-w-0 max-w-[250px] border-b border-foreground-muted active:opacity-65"
          >
            <Text
              className="text-2xl font-t3-medium tracking-tight text-foreground"
              numberOfLines={1}
            >
              {selectedProject.title}
            </Text>
          </Pressable>
          <Text className="text-2xl font-t3-medium tracking-tight text-foreground">?</Text>
        </View>
      </View>

      <NewTaskGlassChip active={sceneryChrome}>
        <ComposerInlineControl
          accessibilityLabel={`Environment: ${selectedEnvironmentLabel}`}
          chevronDirection="right"
          disabled={
            composerSelectorsLocked || isComposerInteractionLocked || voiceInput.isBusy
          }
          icon="desktopcomputer"
          label={`on ${selectedEnvironmentLabel}`}
          maxWidth={260}
          onPress={
            flow.environments.length > 1 ? () => openContextPicker("NewTaskEnvironment") : undefined
          }
          showChevron={flow.environments.length > 1}
          static={flow.environments.length <= 1}
        />
      </NewTaskGlassChip>
    </View>
  );
  const heroViewport = (
    <View className="flex-1" collapsable={false}>
      <ScrollView
        alwaysBounceVertical={isKeyboardVisible}
        className="flex-1"
        contentInsetAdjustmentBehavior="never"
        contentContainerClassName="grow items-center pb-[236px] pt-12 ios:pt-[72px]"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        testID="new-task-hero-scroll"
      >
        {hero}
        {sceneryChrome && dailyPhoto !== null && !isKeyboardVisible ? (
          <NewTaskSceneryPlace photo={dailyPhoto} />
        ) : null}
      </ScrollView>
    </View>
  );

  const workspaceControls = (
    <View className="flex-row items-center gap-1 px-2">
      <ComposerInlineControl
        accessibilityHint={`Switches to ${flow.workspaceMode === "local" ? "a new worktree" : "the current checkout"}`}
        accessibilityLabel={workspaceLabel}
        disabled={
          composerSelectorsLocked || isComposerInteractionLocked || voiceInput.isBusy
        }
        iconNode={
          <NewTaskWorkspaceIcon
            workspaceMode={flow.workspaceMode}
            worktreePath={flow.selectedWorktreePath}
          />
        }
        label={workspaceLabel}
        maxWidth={flow.workspaceMode === "local" ? 220 : 148}
        onPress={() => flow.setWorkspaceMode(flow.workspaceMode === "local" ? "worktree" : "local")}
        showChevron={false}
      />

      <ComposerInlineControl
        accessibilityLabel={`${flow.workspaceMode === "worktree" ? "Base branch" : "Branch"}: ${selectedBranchLabel}`}
        chevronDirection="right"
        disabled={composerSelectorsLocked || isComposerInteractionLocked}
        icon="arrow.triangle.branch"
        label={showBranchLoading ? "Loading branches…" : selectedBranchLabel}
        maxWidth={190}
        onPress={() => openContextPicker("NewTaskBranch")}
      />

      <ComposerInlineControl
        accessibilityLabel={
          flow.selectedSkillIds.length > 0
            ? `Skills: ${flow.selectedSkillIds.length} selected`
            : "Skills"
        }
        chevronDirection="right"
        disabled={composerSelectorsLocked}
        icon={{ ios: "sparkles", android: "auto_awesome" }}
        label={
          flow.selectedSkillIds.length > 0 ? `Skills · ${flow.selectedSkillIds.length}` : "Skills"
        }
        maxWidth={120}
        onPress={() => openContextPicker("NewTaskSkills")}
      />
    </View>
  );

  const composerDock = (
    <View
      className={sceneryChrome ? "px-[12px] pt-1" : "bg-sheet px-[12px] pt-1"}
      style={{ paddingBottom: controlsBottomPadding }}
    >
      {!voiceInput.isBusy && composerMenu.trigger && composerMenu.items.length > 0 ? (
        <View className="mb-2">
          <ComposerCommandPopover
            items={composerMenu.items}
            triggerKind={composerMenu.trigger.kind}
            isLoading={composerMenu.isLoading}
            onSelect={composerMenu.onSelect}
          />
        </View>
      ) : null}
      <View className="pb-1">
        <NewTaskGlassChip active={sceneryChrome}>{workspaceControls}</NewTaskGlassChip>
      </View>

      <ComposerSurface
        style={{
          borderRadius: 26,
          minHeight: 140,
          overflow: "hidden",
          paddingBottom: 6,
          paddingTop: 14,
        }}
      >
        {stripAttachments.length > 0 ? (
          <View className="px-[14px] pb-2.5">
            <ComposerAttachmentStrip
              attachments={stripAttachments}
              imageBorderRadius={16}
              imageSize={72}
              onRemove={
                isIncomingShareTransferPending ||
                isDispatching ||
                isComposerInteractionLocked ||
                voiceInput.isBusy
                  ? () => undefined
                  : flow.removeAttachment
              }
            />
          </View>
        ) : null}

        <View className="px-[14px]">{promptEditor}</View>
        <View className="h-1" />

        <Animated.View layout={COMPOSER_LAYOUT_TRANSITION} collapsable={false}>
          <ComposerDictationToolbar showsDictation={isVoiceInputPresented}>
            <ComposerToolbarRow
              paddingBottom={0}
              paddingHorizontal={0}
              paddingTop={0}
              style={{ gap: 0 }}
            >
              <ComposerDictationCancelAction
                presentation={voicePresentation}
                onCancel={voiceInput.cancel}
              />
              {isVoiceInputPresented ? (
                <ComposerDictationStatus
                  audioLevels={voiceInput.audioLevels}
                  elapsedSeconds={voiceInput.elapsedSeconds}
                  phase={voiceInput.state.phase}
                  presentation={voicePresentation}
                  onDismissError={voiceInput.cancel}
                />
              ) : (
                <>
                  <ComposerAttachmentButton
                    disabled={
                      isIncomingShareTransferPending ||
                      isDispatching ||
                      isComposerInteractionLocked
                    }
                    supportsFiles={Boolean(
                      selectedEnvironmentServerConfig?.environment.capabilities.fileAttachments,
                    )}
                    onPickMedia={handlePickMedia}
                    onPickFiles={handlePickFiles}
                  />
                  <ComposerToolbarScroller
                    align="end"
                    contentPaddingRight={8}
                    {...(sceneryChrome
                      ? { fadeOpaque: toolbarFadeOpaque, fadeTransparent: toolbarFadeTransparent }
                      : { fadeSurface: "sheet" as const })}
                  >
                    <ThreadSettingsPickerPopover
                      accessibilityLabel="Model and reasoning settings"
                      disabled={
                        isIncomingShareTransferPending || isComposerInteractionLocked
                      }
                      model={settingsPicker}
                      onSelectModel={handleSelectModelOption}
                      onSelectOption={handleSelectPickerOption}
                      onSelectRuntime={flow.setRuntimeMode}
                    >
                      <ComposerInlineControl
                        accessibilityLabel="Model and reasoning settings"
                        disabled={
                          isIncomingShareTransferPending || isComposerInteractionLocked
                        }
                        emphasized
                        iconNode={
                          <ProviderIcon
                            provider={flow.selectedModelOption?.providerDriver}
                            size={16}
                          />
                        }
                        label={flow.selectedModelOption?.label ?? "Choose model"}
                        maxWidth={152}
                      />
                    </ThreadSettingsPickerPopover>
                    {flow.planModeEnabled ? (
                      <ComposerInlineControl
                        accessibilityHint={`Switches to ${flow.interactionMode === "plan" ? "Build" : "Plan"} mode`}
                        accessibilityLabel={`Interaction mode: ${flow.interactionMode === "plan" ? "Plan" : "Build"}`}
                        disabled={
                          isIncomingShareTransferPending || isComposerInteractionLocked
                        }
                        emphasized
                        icon={
                          flow.interactionMode === "plan"
                            ? { ios: "list.bullet.clipboard", android: "auto_awesome" }
                            : { ios: "hammer", android: "construction" }
                        }
                        label={flow.interactionMode === "plan" ? "Plan" : "Build"}
                        onPress={() =>
                          flow.setInteractionMode(
                            flow.interactionMode === "plan" ? "default" : "plan",
                          )
                        }
                        showChevron={false}
                      />
                    ) : null}
                    {flow.canToggleAutoCreatePullRequest ? (
                      <ComposerToolbarButton
                        accessibilityLabel={
                          autoCreatePullRequest
                            ? "Create PR when done: on"
                            : "Create PR when done: off"
                        }
                        active={autoCreatePullRequest}
                        disabled={
                          isIncomingShareTransferPending || isComposerInteractionLocked
                        }
                        icon="arrow.triangle.pull"
                        label="PR"
                        onPress={toggleAutoCreatePullRequest}
                        showChevron={false}
                      />
                    ) : null}
                  </ComposerToolbarScroller>
                </>
              )}
              <ComposerDictationPrimaryAction
                state={voiceInput.state}
                presentation={voicePresentation}
                isAvailable={voiceInput.isAvailable}
                disabled={
                  isIncomingShareTransferPending ||
                  isImportingShare ||
                  flow.submitting ||
                  isDispatching
                }
                onStart={voiceInput.start}
                onConfirm={voiceInput.stop}
                onCancel={voiceInput.cancel}
              />
              {voicePresentation.showsSend ? (
                <ComposerToolbarButton
                  accessibilityLabel={
                    isDispatching
                      ? (dispatchStatus ?? "Starting task")
                      : environmentConnected
                        ? "Start task"
                        : "Queue task"
                  }
                  disabled={!canStart && !isDispatching}
                  icon={environmentConnected ? "arrow.up" : "tray.and.arrow.up"}
                  loading={isDispatching}
                  onPress={() => void handleStart()}
                  showChevron={false}
                  variant="primary"
                />
              ) : null}
            </ComposerToolbarRow>
          </ComposerDictationToolbar>
        </Animated.View>
      </ComposerSurface>
      {dispatchStatus ? <ComposerDispatchStatusLabel label={dispatchStatus} /> : null}
    </View>
  );

  if (isAndroid) {
    return (
      <NewTaskDraftFrame sceneryChrome={sceneryChrome}>
        <NativeStackScreenOptions options={{ headerShown: false }} />
        <AndroidScreenHeader title="New task" onBack={closeNewTask} />
        {heroViewport}

        <KeyboardStickyView
          enabled={isKeyboardVisible}
          style={DRAFT_COMPOSER_STICKY_STYLE}
          offset={{ ...DRAFT_COMPOSER_STICKY_OFFSET, opened: keyboardOpenedOffset }}
        >
          {composerDock}
        </KeyboardStickyView>
      </NewTaskDraftFrame>
    );
  }

  return (
    <NewTaskDraftFrame sceneryChrome={sceneryChrome}>
      <NativeStackScreenOptions
        options={{
          headerBackVisible: false,
          headerShadowVisible: false,
          title: selectedProject.title,
        }}
      />
      <NativeHeaderToolbar placement="left">
        <NativeHeaderToolbar.Button
          accessibilityLabel="Cancel new task"
          label="Cancel"
          onPress={closeNewTask}
        />
      </NativeHeaderToolbar>

      {heroViewport}

      {/* Pad the whole draft chrome from the live IME height. formSheet
          measureInWindow under-lifts automaticOffset; visibility still gates
          the padding so a dismiss that leaves height stale cannot strand it
          during send. */}
      <Animated.View
        layout={COMPOSER_LAYOUT_TRANSITION}
        pointerEvents="box-none"
        style={[{ position: "absolute", bottom: 0, left: 0, right: 0 }, draftKeyboardAvoidStyle]}
      >
        {composerDock}
      </Animated.View>
    </NewTaskDraftFrame>
  );
}
