import {
  ANTIGRAVITY_DEFAULT_MODEL,
  DEFAULT_RUNTIME_MODE,
  type EnvironmentId,
  effectiveRuntimeModeForProviderDriver,
  isProviderDriverKind,
  ProjectId,
  type MessageId,
  type ModelSelection,
  type PreviewAnnotationPayload,
  type ProviderInteractionMode,
  ProviderDriverKind,
  type ProviderInstanceId,
  type RuntimeMode,
  type ServerProvider,
  type ScopedProjectRef,
  type ScopedThreadRef,
  resolveRuntimeModeForProviderDriver,
  type ThreadId,
  type ThreadLinkedPullRequest,
  type TurnId,
} from "@t3tools/contracts";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  appendCodexArtifactTemplateUsePrompt,
  codexArtifactTemplateUsePrompt,
  type CodexArtifactTemplate,
} from "@t3tools/client-runtime/codex-artifact-templates";
import {
  type ChatMessage,
  isImageAttachment,
  type SessionPhase,
  type Thread,
  type ThreadShell,
  type TurnDiffSummary,
  type ChatFileAttachment,
} from "../types";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { videoMimeType } from "@t3tools/shared/video";
import type { AssetCreateUrlInput, AssetCreateUrlResult } from "@t3tools/contracts";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { type ComposerImageAttachment, type DraftThreadState } from "../composerDraftStore";
import * as Schema from "effect/Schema";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentThreadDetails } from "../state/threads";
import { stripInlineContextReferences } from "~/lib/composerContextReferences";
import { filterTerminalContextsWithText, type TerminalContextDraft } from "../lib/terminalContext";
import type { DraftThreadEnvMode } from "../composerDraftStore";
import { collapseExpandedComposerCursor, type ComposerSubmissionIntent } from "../composer-logic";
import type { ReviewCommentContext } from "../reviewCommentContext";
import type { TimelineEntry } from "../session-logic";
import type { PreviewMiniPlayerSource } from "../previewMiniPlayerStore";
import type { DesktopPreviewOverlay } from "../previewStateStore";
import type { RightPanelSurface } from "../rightPanelStore";
import {
  NO_PROVIDER_MODEL_SELECTION,
  resolveSelectableProviderInstanceEntry,
  type ProviderInstanceEntry,
} from "../providerInstances";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "t3code:last-invoked-script-by-project";
export const MAX_HIDDEN_MOUNTED_TERMINAL_THREADS = 3;
export const MAX_HIDDEN_MOUNTED_PREVIEW_THREADS = 3;
export const ENVIRONMENT_RECONNECT_WARNING_GRACE_MS = 2_000;

export function shoulderTabReserve(overlay: HTMLElement): number {
  if (overlay.querySelector(".chat-composer-tasks-tab")) return 0;
  const tab = overlay.querySelector<HTMLElement>(".chat-composer-shoulder-tab");
  const surface = overlay.querySelector<HTMLElement>('[data-chat-composer-main-surface="true"]');
  if (!tab || !surface) return 0;
  return Math.max(
    0,
    Math.round(surface.getBoundingClientRect().top - tab.getBoundingClientRect().top),
  );
}

export interface QueuedComposerMessage {
  readonly id: MessageId;
  readonly text: string;
  readonly attachmentCount: number;
}

/** Identify the queued message whose server turn has started. */
export function startedQueuedComposerMessageId(input: {
  queuedMessages: ReadonlyArray<QueuedComposerMessage>;
  serverMessages: ReadonlyArray<ChatMessage>;
  latestTurn: Thread["latestTurn"] | null;
}): MessageId | null {
  if (input.queuedMessages.length === 0 || input.latestTurn === null) return null;
  const queuedIds = new Set(input.queuedMessages.map((message) => message.id));
  if (input.latestTurn.userMessageId !== undefined) {
    return queuedIds.has(input.latestTurn.userMessageId) ? input.latestTurn.userMessageId : null;
  }
  return (
    input.serverMessages.find(
      (message) => queuedIds.has(message.id) && message.createdAt === input.latestTurn?.requestedAt,
    )?.id ?? null
  );
}

/** Keep queued copy at the composer until the server starts its turn. */
export function reconcileQueuedComposerMessages(input: {
  queuedMessages: ReadonlyArray<QueuedComposerMessage>;
  serverMessages: ReadonlyArray<ChatMessage>;
  latestTurn: Thread["latestTurn"] | null;
}): ReadonlyArray<QueuedComposerMessage> {
  const startedMessageId = startedQueuedComposerMessageId(input);
  const startedIndex = input.queuedMessages.findIndex((message) => message.id === startedMessageId);
  return startedIndex < 0 ? input.queuedMessages : input.queuedMessages.slice(startedIndex + 1);
}

export interface ChatViewRouteIdentity {
  readonly routeKind: "draft" | "server";
  readonly routeThreadKey: string;
  readonly draftId: string | null;
}

export function shouldResetComposerQueueForRouteChange(
  previous: ChatViewRouteIdentity,
  current: ChatViewRouteIdentity,
): boolean {
  const unchanged =
    previous.routeKind === current.routeKind &&
    previous.routeThreadKey === current.routeThreadKey &&
    previous.draftId === current.draftId;
  const promoted =
    previous.routeKind === "draft" &&
    current.routeKind === "server" &&
    previous.routeThreadKey === current.routeThreadKey;
  return !unchanged && !promoted;
}

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export function agentControlledBrowserCloseConfirmation(
  surfaces: readonly RightPanelSurface[],
  desktopByTabId: Readonly<Record<string, Pick<DesktopPreviewOverlay, "controller"> | undefined>>,
): string | null {
  const activeBrowserCount = surfaces.filter(
    (surface) =>
      surface.kind === "preview" &&
      surface.resourceId !== null &&
      desktopByTabId[surface.resourceId]?.controller === "agent",
  ).length;
  if (activeBrowserCount === 0) return null;
  if (activeBrowserCount === 1) {
    return [
      "Close browser while the agent is using it?",
      "The agent is actively controlling this browser. Closing it may interrupt the current browser action.",
    ].join("\n");
  }
  return [
    `Close ${activeBrowserCount} browsers while the agent is using them?`,
    "The agent is actively controlling these browsers. Closing them may interrupt the current browser actions.",
  ].join("\n");
}

/** The floating player hides only while the same source is rendered in the panel. */
export function shouldRenderPreviewMiniPlayer(
  source: PreviewMiniPlayerSource | null,
  renderedRightPanelSurface: RightPanelSurface | null,
): boolean {
  if (source === null) return false;
  if (source.kind === "browser") {
    return !(
      renderedRightPanelSurface?.kind === "preview" &&
      renderedRightPanelSurface.resourceId === source.tabId
    );
  }
  return !(
    renderedRightPanelSurface?.kind === "device" &&
    renderedRightPanelSurface.target?.hostId === source.hostId &&
    renderedRightPanelSurface.target.deviceId === source.deviceId
  );
}

export function shouldOpenProactivePullRequest(
  previousTargetKey: string | null | undefined,
  targetKey: string | null,
): boolean {
  return targetKey !== null && targetKey !== previousTargetKey;
}

interface ProactivePanelObservation {
  threadKey: string;
  runningTurnId: TurnId | null | undefined;
  targetKey: string | null | undefined;
  userActionTurnId: TurnId | null;
  userActionRevision: number;
}

/** Capture user intent before loading or metadata writes can defer panel activation. */
export function observeProactivePanelUserChoice(
  previous: ProactivePanelObservation | null,
  input: { threadKey: string; runningTurnId: TurnId | null; userActionRevision: number },
): ProactivePanelObservation {
  const sameThread = previous?.threadKey === input.threadKey;
  const newTurn =
    sameThread && input.runningTurnId !== null && input.runningTurnId !== previous.userActionTurnId;
  return {
    threadKey: input.threadKey,
    runningTurnId: sameThread ? previous.runningTurnId : undefined,
    targetKey: sameThread ? previous.targetKey : undefined,
    userActionTurnId: input.runningTurnId ?? (sameThread ? previous.userActionTurnId : null),
    userActionRevision:
      !sameThread || newTurn ? input.userActionRevision : previous.userActionRevision,
  };
}

/** Follow a changed server link only when the panel still shows the previous linked PR. */
export function shouldRetargetThreadPullRequestPanel(
  previous: ThreadLinkedPullRequest | null,
  current: ThreadLinkedPullRequest | null,
  surface: RightPanelSurface | null,
): boolean {
  if (previous === null || current === null || surface?.kind !== "pull-request") return false;
  const previousRepository = previous.repository.toLowerCase();
  return (
    (previous.projectId !== current.projectId ||
      previousRepository !== current.repository.toLowerCase() ||
      previous.number !== current.number) &&
    surface.projectId === previous.projectId &&
    surface.repository.toLowerCase() === previousRepository &&
    surface.number === previous.number
  );
}

export function shouldOpenProactiveTurnDiff(input: {
  previousRunningTurnId: TurnId | null | undefined;
  runningTurnId: TurnId | null;
  settledTurnId: TurnId | null;
  turnCompleted: boolean;
}): boolean {
  return (
    input.runningTurnId === null &&
    input.turnCompleted &&
    input.settledTurnId !== null &&
    (input.previousRunningTurnId === undefined ||
      input.settledTurnId === input.previousRunningTurnId)
  );
}

export function resolveProactiveTurnDiffAction(input: {
  checkpoint: Pick<TurnDiffSummary, "status" | "files"> | undefined;
  isGitRepo: boolean | undefined;
}): "defer" | "ignore" | "open" {
  if (input.checkpoint === undefined || input.checkpoint.status === "missing") return "defer";
  if (input.isGitRepo === undefined) return "defer";
  if (
    !input.isGitRepo ||
    input.checkpoint.status !== "ready" ||
    input.checkpoint.files.length === 0
  ) {
    return "ignore";
  }
  return "open";
}

export function codexArtifactTemplatePromptToAppend(
  currentDraft: string,
  template: CodexArtifactTemplate,
): string | null {
  return appendCodexArtifactTemplateUsePrompt(currentDraft, template) === currentDraft
    ? null
    : codexArtifactTemplateUsePrompt(template);
}

export function shouldDockDraftHeroForSubmission(input: {
  isDraftHeroState: boolean;
  activeThreadKey: string | null;
  submissionIntent: ComposerSubmissionIntent;
}): boolean {
  return (
    input.submissionIntent === "foreground" &&
    input.isDraftHeroState &&
    input.activeThreadKey !== null
  );
}

export function shouldReleaseTimelineAnchorForToolActivity(input: {
  anchorMessageId: MessageId | null;
  liveFollowEnabled: boolean;
  runningTurnId: TurnId | null;
  timelineEntries: ReadonlyArray<TimelineEntry>;
}): boolean {
  if (input.anchorMessageId === null || !input.liveFollowEnabled || input.runningTurnId === null) {
    return false;
  }

  return input.timelineEntries.some((timelineEntry) => {
    if (timelineEntry.kind !== "work" || timelineEntry.entry.turnId !== input.runningTurnId) {
      return false;
    }

    const entry = timelineEntry.entry;
    return (
      entry.tone === "tool" ||
      entry.itemType !== undefined ||
      entry.requestKind !== undefined ||
      (entry.command?.trim().length ?? 0) > 0
    );
  });
}

export function toolGroupConsumesUpwardNavigation(target: EventTarget | null): boolean {
  const elementTarget = target instanceof Element ? target : null;
  const group = elementTarget?.closest<HTMLElement>("[data-tool-group-scroll]");
  if (!group) return false;

  // A nested result or the group itself can consume an upward scroll.
  for (let element = elementTarget; element; element = element.parentElement) {
    if (element.scrollTop > 0) {
      const overflowY = getComputedStyle(element).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return true;
    }
    if (element === group) break;
  }
  return false;
}

export function resolveDraftHeroState(input: {
  isLocalDraftThread: boolean;
  hasTimelineEntries: boolean;
  isWorking: boolean;
  draftHeroDockRequested: boolean;
  backgroundSubmissionPending: boolean;
}): boolean {
  if (input.backgroundSubmissionPending) {
    return true;
  }
  return (
    input.isLocalDraftThread &&
    !input.hasTimelineEntries &&
    !input.isWorking &&
    !input.draftHeroDockRequested
  );
}

/**
 * Keep painted timelines on screen across thread jumps. Remounting LegendList
 * (or handing it an empty first paint) punches a hole through the chat pane —
 * white in light mode — so cmd+1/2/3 spam flashes even when the destination
 * is already cached.
 *
 * Stored at module scope because ChatView remounts when the thread route
 * changes (same pattern as the thread-error banner session dismissals).
 * Remember more than the last thread so jumping back to cmd+1 does not show
 * cmd+3's messages, and so a cached destination can paint on the first frame.
 */
export type HeldThreadTimeline<T extends readonly unknown[]> = {
  threadKey: string | null;
  entries: T;
  markdownCwd?: string | null;
  workspaceRoot?: string | null;
};

const MAX_REMEMBERED_THREAD_TIMELINES = 16;

let rememberedThreadTimelines = new Map<string, HeldThreadTimeline<readonly unknown[]>>();
let rememberedThreadTimelineOrder: string[] = [];
let lastReadyThreadKey: string | null = null;

function rememberThreadTimelineEntries(held: HeldThreadTimeline<readonly unknown[]>): void {
  if (held.threadKey === null) {
    return;
  }
  rememberedThreadTimelines.set(held.threadKey, held);
  rememberedThreadTimelineOrder = [
    ...rememberedThreadTimelineOrder.filter((key) => key !== held.threadKey),
    held.threadKey,
  ];
  while (rememberedThreadTimelineOrder.length > MAX_REMEMBERED_THREAD_TIMELINES) {
    const evicted = rememberedThreadTimelineOrder.shift();
    if (evicted !== undefined) {
      rememberedThreadTimelines.delete(evicted);
    }
  }
  lastReadyThreadKey = held.threadKey;
}

export function rememberReadyThreadTimeline<T extends readonly unknown[]>(
  held: HeldThreadTimeline<T>,
): void {
  if (held.threadKey === null || held.entries.length === 0) {
    return;
  }
  rememberThreadTimelineEntries(held);
}

export function peekRememberedThreadTimeline<T extends readonly unknown[]>(
  threadKey: string | null,
): T | null {
  if (threadKey === null) {
    return null;
  }
  return (rememberedThreadTimelines.get(threadKey)?.entries as T | undefined) ?? null;
}

export function peekHeldThreadTimeline<
  T extends readonly unknown[],
>(): HeldThreadTimeline<T> | null {
  if (lastReadyThreadKey === null) {
    return null;
  }
  const held = rememberedThreadTimelines.get(lastReadyThreadKey);
  if (held === undefined || held.entries.length === 0) {
    return null;
  }
  return held as HeldThreadTimeline<T>;
}

export function resetHeldThreadTimeline(): void {
  rememberedThreadTimelines = new Map();
  rememberedThreadTimelineOrder = [];
  lastReadyThreadKey = null;
}

export function threadKeysShareEnvironment(left: string | null, right: string | null): boolean {
  if (left === null || right === null) {
    return false;
  }
  const leftRef = parseScopedThreadKey(left);
  const rightRef = parseScopedThreadKey(right);
  return leftRef !== null && rightRef !== null && leftRef.environmentId === rightRef.environmentId;
}

/** True while we still paint another thread's last snapshot. */
export function isPaintOnlyThreadTimeline(
  displayThreadKey: string | null,
  activeThreadKey: string | null,
): boolean {
  return (
    displayThreadKey !== null && activeThreadKey !== null && displayThreadKey !== activeThreadKey
  );
}

export function resolveThreadSwitchTimeline<T extends readonly unknown[]>(input: {
  loading: boolean;
  activeThreadKey: string | null;
  nextEntries: T;
  rememberedForActive?: T | null;
  lastReady?: HeldThreadTimeline<T> | null;
}): { entries: T; displayThreadKey: string | null } {
  if (input.nextEntries.length > 0) {
    return { entries: input.nextEntries, displayThreadKey: input.activeThreadKey };
  }

  const rememberedForActive =
    input.rememberedForActive ?? peekRememberedThreadTimeline<T>(input.activeThreadKey);
  if (input.loading && rememberedForActive !== null && rememberedForActive.length > 0) {
    return { entries: rememberedForActive, displayThreadKey: input.activeThreadKey };
  }

  const lastReady = input.lastReady ?? peekHeldThreadTimeline<T>();
  if (
    input.loading &&
    lastReady !== null &&
    lastReady.threadKey !== null &&
    lastReady.threadKey !== input.activeThreadKey &&
    lastReady.entries.length > 0 &&
    threadKeysShareEnvironment(lastReady.threadKey, input.activeThreadKey)
  ) {
    return { entries: lastReady.entries, displayThreadKey: lastReady.threadKey };
  }
  return { entries: input.nextEntries, displayThreadKey: input.activeThreadKey };
}

export function resolveDraftPromotionNavigationTarget(input: {
  serverThreadRef: ScopedThreadRef | null;
  serverThread: Pick<Thread, "latestTurn" | "session"> | null | undefined;
  backgroundSubmissionPending: boolean;
}): ScopedThreadRef | null {
  if (input.backgroundSubmissionPending) {
    return null;
  }
  const sessionStatus = input.serverThread?.session?.status;
  const turnStarted = input.serverThread?.latestTurn?.startedAt != null;
  const startupStopped =
    sessionStatus === "error" || sessionStatus === "stopped" || sessionStatus === "interrupted";
  // Keep local preparation feedback mounted until the server can render the
  // running turn or its startup error on the canonical thread route.
  return turnStarted || startupStopped ? input.serverThreadRef : null;
}

export function scheduleEnvironmentReconnectWarning(showWarning: () => void): () => void {
  const timeoutId = globalThis.setTimeout(showWarning, ENVIRONMENT_RECONNECT_WARNING_GRACE_MS);
  return () => globalThis.clearTimeout(timeoutId);
}

export function hasEnvironmentReconnectWarningGraceElapsed(
  activeEnvironmentId: EnvironmentId | null,
  elapsedEnvironmentId: EnvironmentId | null,
): boolean {
  return activeEnvironmentId !== null && activeEnvironmentId === elapsedEnvironmentId;
}

export function startNewThreadForProject(
  projectRef: ScopedProjectRef | null,
  handleNewThread: (projectRef: ScopedProjectRef) => Promise<unknown>,
): boolean {
  if (projectRef === null) return false;
  void handleNewThread(projectRef);

  return true;
}

export function resolveThreadMetadataUpdateForNextTurn(input: {
  currentModelSelection: ModelSelection;
  nextModelSelection?: ModelSelection;
  currentBranch: string | null;
  nextBranch?: string;
}): {
  modelSelection?: ModelSelection;
  branch?: string;
  worktreePath?: null;
} | null {
  const nextModelSelection = input.nextModelSelection;
  const modelSelectionChanged =
    nextModelSelection !== undefined &&
    (nextModelSelection.model !== input.currentModelSelection.model ||
      nextModelSelection.instanceId !== input.currentModelSelection.instanceId ||
      JSON.stringify(nextModelSelection.options ?? null) !==
        JSON.stringify(input.currentModelSelection.options ?? null));
  const branchChanged = input.nextBranch !== undefined && input.nextBranch !== input.currentBranch;
  if (!modelSelectionChanged && !branchChanged) {
    return null;
  }
  return {
    ...(modelSelectionChanged ? { modelSelection: nextModelSelection } : {}),
    ...(branchChanged ? { branch: input.nextBranch, worktreePath: null } : {}),
  };
}

// Composer pick wins, including an explicit "full-access" that a carry or
// picker wrote there. A server thread's stored mode is authoritative. A
// draft whose thread mode still reads as the generic default (never picked,
// never recorded on the composer) inherits the provider's own default.
// Remapped carries must land in composerRuntimeMode so they are not treated
// as unset.
export function storedComposerRuntimeMode(input: {
  readonly composerRuntimeMode: RuntimeMode | null;
  readonly threadRuntimeMode: RuntimeMode | null | undefined;
  readonly isServerThread: boolean;
}): RuntimeMode | null {
  return (
    input.composerRuntimeMode ??
    (input.isServerThread
      ? (input.threadRuntimeMode ?? null)
      : input.threadRuntimeMode !== DEFAULT_RUNTIME_MODE
        ? (input.threadRuntimeMode ?? null)
        : null)
  );
}

// Apply the provider default, then remap historical "yolo" to full-access
// so the composer never offers a mode the current provider does not have.
export function resolveComposerRuntimeMode(input: {
  readonly providerDriver: string | null | undefined;
  readonly composerRuntimeMode: RuntimeMode | null;
  readonly threadRuntimeMode: RuntimeMode | null | undefined;
  readonly isServerThread: boolean;
}): RuntimeMode {
  return effectiveRuntimeModeForProviderDriver(
    input.providerDriver,
    storedComposerRuntimeMode(input),
  );
}

// New threads copy the viewed thread's access mode. When the destination
// provider is known, historical "yolo" becomes generic full-access. Unknown
// destination keeps the carried value; the composer remaps at display/send
// time.
export function resolveCarriedRuntimeMode(input: {
  readonly runtimeMode: RuntimeMode | null;
  readonly destinationProviderDriver: string | null | undefined;
}): RuntimeMode | null {
  if (input.runtimeMode == null) {
    return null;
  }
  if (input.destinationProviderDriver == null) {
    return input.runtimeMode;
  }
  return resolveRuntimeModeForProviderDriver(input.destinationProviderDriver, input.runtimeMode);
}

// The composer pick a new-thread carry should record. Only a carry with real
// information becomes an explicit pick: a non-default mode, or "full-access"
// that remapping historical yolo produced. A plain carried "full-access"
// stays unset so a new draft still inherits the provider default.
export function resolveCarriedComposerRuntimeMode(input: {
  readonly runtimeMode: RuntimeMode | null;
  readonly destinationProviderDriver: string | null | undefined;
}): RuntimeMode | null {
  const carried = resolveCarriedRuntimeMode(input);
  if (carried === null) {
    return null;
  }
  return carried !== DEFAULT_RUNTIME_MODE || carried !== input.runtimeMode ? carried : null;
}

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModelSelection: ModelSelection,
): Thread {
  return {
    id: threadId,
    environmentId: draftThread.environmentId,
    projectId: draftThread.projectId,
    title: "New thread",
    modelSelection: fallbackModelSelection,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    createdAt: draftThread.createdAt,
    updatedAt: draftThread.createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestTurn: null,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    checkpoints: [],
    pullRequests: [],
    activities: [],
    proposedPlans: [],
    enabledSkillIds: [],
  };
}

export function buildLoadingThreadFromShell(shell: ThreadShell): Thread {
  return {
    ...shell,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    deletedAt: null,
  };
}

export function shouldWriteThreadErrorToCurrentServerThread(input: {
  activeServerThread:
    | {
        environmentId: EnvironmentId;
        id: ThreadId;
      }
    | null
    | undefined;
  routeThreadRef: ScopedThreadRef;
  targetThreadId: ThreadId;
}): boolean {
  return Boolean(
    input.activeServerThread &&
    input.targetThreadId === input.routeThreadRef.threadId &&
    input.activeServerThread.environmentId === input.routeThreadRef.environmentId &&
    input.activeServerThread.id === input.targetThreadId,
  );
}

export function buildThreadTurnInterruptInput(thread: Pick<Thread, "id" | "session">): {
  threadId: ThreadId;
  turnId?: TurnId;
} {
  const runningTurnId = thread.session?.status === "running" ? thread.session.activeTurnId : null;
  return {
    threadId: thread.id,
    ...(runningTurnId !== null ? { turnId: runningTurnId } : {}),
  };
}

/** Use the same enabled instance for the composer, provider status, and chat actions. */
export function resolveComposerProviderSelection(input: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  candidateInstanceIds: ReadonlyArray<ProviderInstanceId | null | undefined>;
  lockedProvider: ProviderDriverKind | null;
  lockedInstanceId: ProviderInstanceId | null | undefined;
}) {
  const requestedInstanceId = input.candidateInstanceIds.find(
    (candidate) => candidate != null && candidate !== NO_PROVIDER_MODEL_SELECTION.instanceId,
  );
  const requestedDriverKind =
    input.lockedProvider ??
    input.entries.find((entry) => entry.instanceId === requestedInstanceId)?.driverKind ??
    input.entries[0]?.driverKind ??
    ProviderDriverKind.make("unconfigured");
  const lockedContinuationGroupKey = input.lockedProvider
    ? (input.entries.find((entry) => entry.instanceId === input.lockedInstanceId)
        ?.continuationGroupKey ?? null)
    : null;
  // Missing metadata must not move Antigravity history into another Google profile.
  const requiresExactInstance =
    input.lockedProvider === "antigravity" &&
    input.lockedInstanceId != null &&
    lockedContinuationGroupKey === null;
  const compatibleEntries = input.entries.filter(
    (entry) =>
      (!input.lockedProvider || entry.driverKind === input.lockedProvider) &&
      (!lockedContinuationGroupKey || entry.continuationGroupKey === lockedContinuationGroupKey) &&
      (!requiresExactInstance || entry.instanceId === input.lockedInstanceId),
  );
  const selectedProviderEntry =
    input.candidateInstanceIds
      .map((candidate) =>
        compatibleEntries.find(
          (entry) => entry.instanceId === candidate && entry.enabled && entry.isAvailable,
        ),
      )
      .find((entry) => entry !== undefined) ??
    resolveSelectableProviderInstanceEntry(
      compatibleEntries.filter((entry) => entry.driverKind === requestedDriverKind),
      undefined,
    ) ??
    resolveSelectableProviderInstanceEntry(compatibleEntries, undefined);
  const unavailableProviderInstanceId = selectedProviderEntry
    ? undefined
    : input.lockedProvider
      ? (input.lockedInstanceId ?? requestedInstanceId)
      : requestedInstanceId;
  return {
    selectedProviderEntry,
    requestedDriverKind,
    lockedContinuationGroupKey,
    unavailableProviderInstanceId,
  };
}

/** Keep restored drafts and every plan control on the selected instance's supported mode. */
export function resolveComposerInteractionMode(input: {
  planModeEnabled: boolean;
  provider: Pick<ServerProvider, "showInteractionModeToggle"> | null | undefined;
  interactionMode: ProviderInteractionMode;
}): { enabled: boolean; interactionMode: ProviderInteractionMode } {
  const enabled =
    input.planModeEnabled &&
    input.provider != null &&
    input.provider.showInteractionModeToggle !== false;
  return {
    enabled,
    interactionMode: enabled ? input.interactionMode : "default",
  };
}

export function getAntigravitySendBlockReason(
  provider:
    | Pick<ServerProvider, "driver" | "installed" | "auth" | "models" | "status">
    | null
    | undefined,
  model: string,
): string | null {
  if (provider?.driver !== "antigravity") return null;
  if (!provider.installed) {
    return "Install Antigravity in provider settings before sending.";
  }
  if (provider.auth.status === "unauthenticated") {
    return "Sign in to Antigravity in provider settings before sending.";
  }
  const slug = model.trim();
  if (slug.length === 0) return "Choose an Antigravity model before sending.";
  // A restart clears the account status and catalog. Session startup checks
  // saved credentials and validates the model before sending the prompt.
  if (provider.auth.status === "unknown") return null;
  if (provider.models.length === 0) {
    return "Refresh Antigravity models in provider settings before sending.";
  }
  // A saved model that left the catalog is kept in the picker as unavailable
  // so the user sees what the thread used. The server rejects it at turn
  // start, so block here unless the provider is in an error state, where a
  // retry with the same model is the right move.
  if (
    provider.status === "ready" &&
    slug !== ANTIGRAVITY_DEFAULT_MODEL &&
    !provider.models.some((entry) => entry.slug === slug || entry.aliases?.includes(slug))
  ) {
    return "That Antigravity model is no longer available. Choose another model.";
  }
  return null;
}

export function buildRunningThreadTurnInterruptInput(
  thread: Pick<Thread, "id" | "session"> | null | undefined,
  phase: SessionPhase,
): { threadId: ThreadId; turnId?: TurnId } | null {
  if (phase !== "running" || thread?.session?.status !== "running") {
    return null;
  }
  return buildThreadTurnInterruptInput(thread);
}

export function reconcileMountedTerminalThreadIds(input: {
  currentThreadIds: ReadonlyArray<string>;
  openThreadIds: ReadonlyArray<string>;
  activeThreadId: string | null;
  activeThreadTerminalOpen: boolean;
  activeThreadTerminalExiting?: boolean;
  maxHiddenThreadCount?: number;
}): string[] {
  return reconcileRetainedMountedThreadIds({
    currentThreadIds: input.currentThreadIds,
    openThreadIds: input.openThreadIds,
    activeThreadId: input.activeThreadId,
    activeThreadOpen: input.activeThreadTerminalOpen || input.activeThreadTerminalExiting === true,
    maxHiddenThreadCount: input.maxHiddenThreadCount ?? MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  });
}

export function reconcileRetainedMountedThreadIds(input: {
  currentThreadIds: ReadonlyArray<string>;
  openThreadIds: ReadonlyArray<string>;
  activeThreadId: string | null;
  activeThreadOpen: boolean;
  maxHiddenThreadCount: number;
  retainInactiveActiveThread?: boolean;
}): string[] {
  const openThreadIdSet = new Set(input.openThreadIds);
  const hiddenThreadIds = input.currentThreadIds.filter(
    (threadId) =>
      (threadId !== input.activeThreadId || input.retainInactiveActiveThread === true) &&
      openThreadIdSet.has(threadId),
  );
  const maxHiddenThreadCount = Math.max(0, input.maxHiddenThreadCount);
  const nextThreadIds =
    hiddenThreadIds.length > maxHiddenThreadCount
      ? hiddenThreadIds.slice(-maxHiddenThreadCount)
      : hiddenThreadIds;

  if (
    input.activeThreadId &&
    input.activeThreadOpen &&
    !nextThreadIds.includes(input.activeThreadId)
  ) {
    nextThreadIds.push(input.activeThreadId);
  }

  return nextThreadIds;
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export async function loadVideoPreviewUrl(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Could not load video (${response.status}).`);
  return URL.createObjectURL(await response.blob());
}

export async function prepareRevertedMessageAttachments(input: {
  message: ChatMessage;
  environmentId: EnvironmentId;
  httpBaseUrl: string;
  createAssetUrl: Parameters<typeof resolveFileAttachmentUrl>[0]["createAssetUrl"];
}): Promise<File[]> {
  return Promise.all(
    (input.message.attachments ?? []).map(async (attachment) => {
      if (attachment.type !== "image" && attachment.type !== "file") {
        throw new Error("This message has an attachment that cannot be restored.");
      }
      const result = await input.createAssetUrl({
        environmentId: input.environmentId,
        input: {
          resource: {
            _tag: "attachment",
            attachmentId: attachment.id,
            fileName: attachment.name,
            mimeType: attachment.mimeType,
          },
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const url = resolveAssetUrl(input.httpBaseUrl, result.value.relativeUrl);
      if (url === null) throw new Error("The environment returned an invalid attachment URL.");
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Could not restore attachment: ${attachment.name}`);
      return new File([await response.blob()], attachment.name, { type: attachment.mimeType });
    }),
  );
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (!isImageAttachment(attachment)) {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function timelineHasEphemeralPreviewUrls(
  entries: ReadonlyArray<Pick<TimelineEntry, "kind"> & { message?: ChatMessage }>,
): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "message" &&
      entry.message !== undefined &&
      collectUserMessageBlobPreviewUrls(entry.message).length > 0,
  );
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (!isImageAttachment(attachment)) continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

/** Signs an attachment URL without reading its bytes, so video playback can request byte ranges. */
export async function resolveFileAttachmentUrl(input: {
  attachment: ChatFileAttachment;
  environmentId: EnvironmentId;
  httpBaseUrl: string;
  createAssetUrl: (input: {
    environmentId: EnvironmentId;
    input: AssetCreateUrlInput;
  }) => Promise<AtomCommandResult<AssetCreateUrlResult, unknown>>;
}): Promise<string> {
  const { attachment } = input;
  const result = await input.createAssetUrl({
    environmentId: input.environmentId,
    input: {
      resource: {
        _tag: "attachment",
        attachmentId: attachment.id,
        fileName: attachment.name,
        mimeType: videoMimeType(attachment) ?? attachment.mimeType,
      },
    },
  });
  if (result._tag === "Failure") throw new Error("Failed to create asset URL");
  const url = resolveAssetUrl(input.httpBaseUrl, result.value.relativeUrl);
  if (url === null) throw new Error("The environment returned an invalid attachment URL.");
  return url;
}

export function resolveSendEnvMode(input: {
  requestedEnvMode: DraftThreadEnvMode;
  isGitRepo: boolean;
}): DraftThreadEnvMode {
  return input.isGitRepo ? input.requestedEnvMode : "local";
}

export function resolveBackgroundDraftWorkspaceOptions(input: {
  envMode: DraftThreadEnvMode;
  branch: string | null;
  startFromOrigin: boolean;
}): {
  envMode: DraftThreadEnvMode;
  branch: string | null;
  worktreePath: null;
  startFromOrigin: boolean;
} {
  return {
    envMode: input.envMode,
    branch: input.branch,
    worktreePath: null,
    startFromOrigin: input.envMode === "worktree" && input.startFromOrigin,
  };
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  /**
   * Optional element-pick attachment count. Element contexts contribute to
   * "sendable content" exactly like images and (text-bearing) terminal
   * contexts do: a prompt of just element chips is still a valid send.
   */
  elementContextCount?: number;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineContextReferences(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  const elementContextCount = options.elementContextCount ?? 0;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 ||
      options.imageCount > 0 ||
      sendableTerminalContexts.length > 0 ||
      elementContextCount > 0,
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

export function branchMismatchKey(
  threadId: string | null,
  mismatch: { threadBranch: string; currentBranch: string } | null,
): string | null {
  if (!threadId || !mismatch) {
    return null;
  }
  return `${threadId}:${mismatch.threadBranch}:${mismatch.currentBranch}`;
}

// The mismatch banner only matters when the user is about to send: passive
// reading of an old thread carries no risk (the branch picker tint already
// covers ambient awareness). Draft content is the intent signal — composer
// focus is useless here because ChatView autofocuses the composer on every
// thread open. `wasShownForCurrentMismatch` keeps the banner mounted once
// revealed so it doesn't flicker away when the draft is cleared.
export function shouldShowBranchMismatchBanner(input: {
  hasMismatch: boolean;
  isDismissed: boolean;
  composerHasContent: boolean;
  wasShownForCurrentMismatch: boolean;
}): boolean {
  if (!input.hasMismatch || input.isDismissed) {
    return false;
  }
  return input.composerHasContent || input.wasShownForCurrentMismatch;
}

export function shouldShowPlanFollowUpPrompt(input: {
  pendingUserInputCount: number;
  interactionMode: ProviderInteractionMode;
  latestTurnSettled: boolean;
  hasActionableProposedPlan: boolean;
  hasComposerAttachments: boolean;
}): boolean {
  return (
    input.pendingUserInputCount === 0 &&
    input.interactionMode === "plan" &&
    input.latestTurnSettled &&
    input.hasActionableProposedPlan &&
    !input.hasComposerAttachments
  );
}

// Session-scoped (module-level so it survives ChatView remounts, e.g. route
// changes). Durable cross-device dismissal is planned as a server-side ack.
const sessionDismissedBranchMismatchKeys = new Set<string>();
const MAX_SESSION_DISMISSED_BRANCH_MISMATCHES = 256;

export function dismissBranchMismatchForSession(key: string): void {
  sessionDismissedBranchMismatchKeys.delete(key);
  sessionDismissedBranchMismatchKeys.add(key);
  if (sessionDismissedBranchMismatchKeys.size > MAX_SESSION_DISMISSED_BRANCH_MISMATCHES) {
    const oldest = sessionDismissedBranchMismatchKeys.values().next().value;
    if (oldest !== undefined) sessionDismissedBranchMismatchKeys.delete(oldest);
  }
}

export function isBranchMismatchDismissedForSession(key: string | null): boolean {
  return key !== null && sessionDismissedBranchMismatchKeys.has(key);
}

// Git status for a checkout arrives after the composer paints, and the branch
// strip mounts on the assumption that a project is a Git repo. Without a
// memory, a non-Git project would mount the strip and drop it on every visit.
// Keyed by environment and checkout for the session; never persisted.
const sessionCheckoutIsRepo = new Map<string, boolean>();

function checkoutIsRepoKey(environmentId: EnvironmentId, cwd: string): string {
  return JSON.stringify([environmentId, cwd]);
}

export function rememberCheckoutIsRepo(
  environmentId: EnvironmentId,
  cwd: string,
  isRepo: boolean,
): void {
  sessionCheckoutIsRepo.set(checkoutIsRepoKey(environmentId, cwd), isRepo);
}

export function recallCheckoutIsRepo(
  environmentId: EnvironmentId,
  cwd: string | null,
): boolean | undefined {
  return cwd === null
    ? undefined
    : sessionCheckoutIsRepo.get(checkoutIsRepoKey(environmentId, cwd));
}

export function threadHasStarted(
  thread:
    | {
        readonly latestTurn: unknown;
        readonly session: unknown;
        readonly messages?: { readonly length: number };
      }
    | null
    | undefined,
): boolean {
  return Boolean(
    thread &&
    (thread.latestTurn !== null || (thread.messages?.length ?? 0) > 0 || thread.session !== null),
  );
}

/**
 * Whether a thread ran at least one turn, judged from its shell alone.
 *
 * `threadHasStarted` needs the detail: a thread whose latest turn was cleared
 * still has messages, and the loading shell carries none. The shell records
 * when the last user message landed, which every started thread has.
 */
export function threadShellHasStarted(
  shell: Pick<ThreadShell, "latestTurn" | "latestUserMessageAt" | "session"> | null | undefined,
): boolean {
  return Boolean(
    shell &&
    (shell.latestTurn !== null || shell.latestUserMessageAt !== null || shell.session !== null),
  );
}

// Imported history has no session until its first prompt. Resolve its instance
// through the environment's provider catalog before locking to a driver.
export function deriveLockedProvider(input: {
  thread: Thread | null | undefined;
  selectedProvider: string | null;
  threadProvider: string | null;
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver">>;
}): ProviderDriverKind | null {
  if (!threadHasStarted(input.thread)) {
    return null;
  }
  const sessionProvider = input.thread?.session?.providerName ?? null;
  if (sessionProvider && isProviderDriverKind(sessionProvider)) {
    return sessionProvider;
  }
  // Preserve the existing lock while an instance is missing from the catalog;
  // a started thread must not silently fall back to a different driver.
  const threadProvider =
    input.providers.find((provider) => provider.instanceId === input.threadProvider)?.driver ??
    input.threadProvider;
  const selectedProvider =
    input.providers.find((provider) => provider.instanceId === input.selectedProvider)?.driver ??
    input.selectedProvider;
  const narrowedThreadProvider =
    threadProvider && isProviderDriverKind(threadProvider) ? threadProvider : null;
  const narrowedSelectedProvider =
    selectedProvider && isProviderDriverKind(selectedProvider) ? selectedProvider : null;
  return narrowedThreadProvider ?? narrowedSelectedProvider ?? null;
}

export function getStartedThreadModelChangeBlockReason(input: {
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "requiresNewThreadForModelChange">>;
  hasStartedSession: boolean;
  supportsProviderHandoff?: boolean;
  currentModelSelection: ModelSelection;
  currentProviderInstanceId?: ModelSelection["instanceId"] | null | undefined;
  nextModelSelection: ModelSelection;
}): { title: string; description: string } | null {
  if (!input.hasStartedSession) {
    return null;
  }
  const currentModelSelection = {
    ...input.currentModelSelection,
    instanceId: input.currentProviderInstanceId ?? input.currentModelSelection.instanceId,
  };
  if (
    currentModelSelection.instanceId === input.nextModelSelection.instanceId &&
    currentModelSelection.model === input.nextModelSelection.model
  ) {
    return null;
  }
  if (
    input.supportsProviderHandoff === true &&
    currentModelSelection.instanceId !== input.nextModelSelection.instanceId
  ) {
    return null;
  }
  const currentProvider = input.providers.find(
    (snapshot) => snapshot.instanceId === currentModelSelection.instanceId,
  );
  const nextProvider = input.providers.find(
    (snapshot) => snapshot.instanceId === input.nextModelSelection.instanceId,
  );
  if (
    currentProvider?.requiresNewThreadForModelChange !== true &&
    nextProvider?.requiresNewThreadForModelChange !== true
  ) {
    return null;
  }
  return {
    title: "Start a new chat to change models",
    description: "This provider does not allow switching models after a conversation has started.",
  };
}

export async function waitForStartedServerThread(
  threadRef: ScopedThreadRef,
  timeoutMs = 1_000,
): Promise<boolean> {
  const threadAtom = environmentThreadDetails.detailAtom(threadRef);
  const getThread = () => appAtomRegistry.get(threadAtom);
  const thread = getThread();

  if (threadHasStarted(thread)) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = appAtomRegistry.subscribe(threadAtom, (thread) => {
      if (!threadHasStarted(thread)) {
        return;
      }
      finish(true);
    });

    if (threadHasStarted(getThread())) {
      finish(true);
      return;
    }

    timeoutId = globalThis.setTimeout(() => {
      finish(false);
    }, timeoutMs);
  });
}

export async function waitForRevertedMessage(
  threadRef: ScopedThreadRef,
  messageId: MessageId,
  turnCount: number,
  revert: () => Promise<void>,
  timeoutMs = 120_000,
): Promise<void> {
  const threadAtom = environmentThreadDetails.detailAtom(threadRef);
  const initial = appAtomRegistry.get(threadAtom);
  if (!initial?.messages.some((message) => message.id === messageId)) {
    throw new Error("The message to rewind is no longer available.");
  }
  const previousFailures = new Set(
    initial.activities
      .filter((activity) => activity.kind === "checkpoint.revert.failed")
      .map((activity) => activity.id),
  );
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let accepted = false;
    let unsubscribe = () => {};
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      unsubscribe();
      if (error !== undefined) reject(error);
      else resolve();
    };
    const inspect = () => {
      const thread = appAtomRegistry.get(threadAtom);
      if (!thread) return;
      const failure = thread.activities.findLast(
        (activity) =>
          activity.kind === "checkpoint.revert.failed" && !previousFailures.has(activity.id),
      );
      if (failure) {
        const payload = failure.payload;
        finish(
          new Error(
            typeof payload === "object" &&
              payload !== null &&
              "detail" in payload &&
              typeof payload.detail === "string"
              ? payload.detail
              : failure.summary,
          ),
        );
      } else if (
        accepted &&
        !thread.messages.some((message) => message.id === messageId) &&
        thread.checkpoints.every((checkpoint) => checkpoint.checkpointTurnCount <= turnCount) &&
        (turnCount === 0
          ? thread.latestTurn === null
          : thread.checkpoints.some(
              (checkpoint) => checkpoint.turnId === thread.latestTurn?.turnId,
            ))
      ) {
        finish();
      }
    };
    unsubscribe = appAtomRegistry.subscribe(threadAtom, inspect);
    timeout = globalThis.setTimeout(() => {
      finish(new Error("Timed out waiting for the thread to rewind."));
    }, timeoutMs);
    Promise.resolve()
      .then(revert)
      .then(() => {
        accepted = true;
        inspect();
      }, finish);
  });
}

export interface LocalDispatchSnapshot {
  startedAt: string;
  preparingWorktree: boolean;
  submissionIntent: ComposerSubmissionIntent;
  latestUserMessageId: ChatMessage["id"] | null;
  latestTurnTurnId: TurnId | null;
  latestTurnRequestedAt: string | null;
  latestTurnStartedAt: string | null;
  latestTurnCompletedAt: string | null;
  sessionStatus: NonNullable<Thread["session"]>["status"] | null;
  sessionUpdatedAt: string | null;
  latestTurnStartFailureId: string | null;
}

export function latestTurnStartFailureId(
  activeThread: Thread | undefined,
  latestUserMessageId: ChatMessage["id"] | null,
): string | null {
  if (latestUserMessageId === null) return null;
  return (
    activeThread?.activities.findLast((activity) => {
      if (activity.kind !== "provider.turn.start.failed") return false;
      const payload =
        typeof activity.payload === "object" && activity.payload !== null
          ? (activity.payload as { readonly requestId?: unknown })
          : null;
      return payload?.requestId === latestUserMessageId;
    })?.id ?? null
  );
}

export function createLocalDispatchSnapshot(
  activeThread: Thread | undefined,
  options?: {
    preparingWorktree?: boolean;
    submissionIntent?: ComposerSubmissionIntent;
  },
): LocalDispatchSnapshot {
  const latestTurn = activeThread?.latestTurn ?? null;
  const session = activeThread?.session ?? null;
  const latestUserMessage = activeThread?.messages.findLast((message) => message.role === "user");
  return {
    startedAt: new Date().toISOString(),
    preparingWorktree: Boolean(options?.preparingWorktree),
    submissionIntent: options?.submissionIntent ?? "foreground",
    latestUserMessageId: latestUserMessage?.id ?? null,
    latestTurnTurnId: latestTurn?.turnId ?? null,
    latestTurnRequestedAt: latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    sessionStatus: session?.status ?? null,
    sessionUpdatedAt: session?.updatedAt ?? null,
    latestTurnStartFailureId: latestTurnStartFailureId(activeThread, latestUserMessage?.id ?? null),
  };
}

function localDispatchHasServerDelta(
  localDispatch: LocalDispatchSnapshot,
  latestTurn: Thread["latestTurn"] | null,
  session: Thread["session"] | null,
): boolean {
  return (
    localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null) ||
    localDispatch.sessionStatus !== (session?.status ?? null) ||
    localDispatch.sessionUpdatedAt !== (session?.updatedAt ?? null)
  );
}

export function hasServerAcknowledgedLocalDispatch(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  latestUserMessageId: ChatMessage["id"] | null;
  session: Thread["session"] | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  latestTurnStartFailureId?: string | null;
  threadError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }
  if (input.hasPendingApproval || input.hasPendingUserInput || Boolean(input.threadError)) {
    return true;
  }
  if (
    input.latestTurnStartFailureId !== undefined &&
    input.latestTurnStartFailureId !== null &&
    input.latestTurnStartFailureId !== input.localDispatch.latestTurnStartFailureId
  ) {
    return true;
  }
  if (input.phase === "connecting") {
    return false;
  }

  const latestTurn = input.latestTurn ?? null;
  const session = input.session ?? null;
  const latestUserMessageChanged =
    input.localDispatch.latestUserMessageId !== input.latestUserMessageId;
  const latestTurnChanged =
    input.localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    input.localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);

  if (input.phase === "running") {
    // Steering adds a user message to the current running turn without
    // necessarily changing any of the turn timestamps. Treat that projected
    // message as the server acknowledgment so the composer does not remain
    // stuck in its local "Sending" state until the turn settles.
    if (latestUserMessageChanged) {
      return true;
    }
    if (!latestTurnChanged) {
      return false;
    }
    if (latestTurn?.startedAt === null || latestTurn === null) {
      return false;
    }
    if (
      session?.activeTurnId !== null &&
      session?.activeTurnId !== undefined &&
      latestTurn?.turnId !== session.activeTurnId
    ) {
      return false;
    }
    return true;
  }

  return localDispatchHasServerDelta(input.localDispatch, latestTurn, session);
}

function sessionLooksBusy(session: Thread["session"] | null): boolean {
  return session?.status === "running" || session?.status === "starting";
}

function sessionLooksIdle(session: Thread["session"] | null): boolean {
  const status = session?.status;
  return (
    status == null ||
    status === "ready" ||
    status === "stopped" ||
    status === "idle" ||
    status === "interrupted"
  );
}

/**
 * Keep the post-send thinking/stop presentation until the turn finishes,
 * the session is no longer busy, or the send fails. Title/branch meta
 * updates while starting/running must not drop the working row. A Stop or
 * a start that never produces a turn settles once the session is
 * ready/stopped/idle and the server has moved past the local snapshot.
 */
export function hasOptimisticWorkingSettled(input: {
  localDispatch: LocalDispatchSnapshot | null;
  latestTurn: Thread["latestTurn"] | null;
  session: Thread["session"] | null;
  threadError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return true;
  }
  if (Boolean(input.threadError) || input.session?.status === "error") {
    return true;
  }
  if (sessionLooksBusy(input.session)) {
    return false;
  }

  const latestTurn = input.latestTurn ?? null;
  const turnCompletedAfterDispatch =
    latestTurn?.completedAt != null &&
    (input.localDispatch.latestTurnTurnId !== latestTurn.turnId ||
      input.localDispatch.latestTurnCompletedAt !== latestTurn.completedAt);
  if (turnCompletedAfterDispatch) {
    return true;
  }

  return (
    sessionLooksIdle(input.session) &&
    localDispatchHasServerDelta(input.localDispatch, latestTurn, input.session)
  );
}

// Returning to the window should land the caret in the composer, so the reader can type right
// away. The exceptions are places where focus is deliberate: another text field, a terminal in
// the drawer or the right panel, or an open dialog or popup. A focused button outside those is
// not one of them, so it yields to the composer.
export function shouldRefocusComposerOnWindowFocus(
  activeElement:
    | (Pick<Element, "tagName" | "closest" | "getAttribute"> & { isContentEditable?: boolean })
    | null,
): boolean {
  if (activeElement === null || activeElement.tagName === "BODY") return true;
  if (
    activeElement.tagName === "INPUT" ||
    activeElement.tagName === "TEXTAREA" ||
    activeElement.tagName === "SELECT" ||
    activeElement.tagName === "IFRAME" ||
    activeElement.tagName === "WEBVIEW" ||
    activeElement.isContentEditable === true ||
    activeElement.getAttribute("role") === "textbox"
  ) {
    return false;
  }
  return (
    activeElement.closest(
      '[role="dialog"], [role="alertdialog"], [data-slot$="-popup"], [data-terminal-owner]',
    ) === null
  );
}

export interface PlanFollowUpComposerSnapshot {
  readonly prompt: string;
  readonly terminalContexts: ReadonlyArray<TerminalContextDraft>;
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
}

/**
 * Puts back everything a plan follow-up send cleared when the send fails. The
 * caller clears the composer before awaiting the send, so every field it held
 * has to be written back here: a dropped field silently discards user context.
 */
export function restorePlanFollowUpComposer(input: {
  readonly snapshot: PlanFollowUpComposerSnapshot;
  readonly writePrompt: (prompt: string) => void;
  readonly writeTerminalContexts: (contexts: ReadonlyArray<TerminalContextDraft>) => void;
  readonly writeReviewComments: (comments: ReadonlyArray<ReviewCommentContext>) => void;
  readonly writePreviewAnnotations: (annotations: ReadonlyArray<PreviewAnnotationPayload>) => void;
  readonly resetCursor: (options: {
    cursor: number;
    prompt: string;
    detectTrigger: boolean;
  }) => void;
}): void {
  input.writePrompt(input.snapshot.prompt);
  input.writeTerminalContexts(input.snapshot.terminalContexts);
  input.writeReviewComments(input.snapshot.reviewComments);
  input.writePreviewAnnotations(input.snapshot.previewAnnotations);
  input.resetCursor({
    cursor: collapseExpandedComposerCursor(input.snapshot.prompt, input.snapshot.prompt.length),
    prompt: input.snapshot.prompt,
    detectTrigger: true,
  });
}
