import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo } from "react";
import { Alert } from "react-native";

import {
  CommandId,
  MessageId,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationThreadActivity,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import { deriveActiveWorkStartedAt } from "@t3tools/shared/orchestrationTiming";

import { makeQueuedMessageMetadata } from "../lib/commandMetadata";
import {
  convertPastedImagesToAttachments,
  pasteComposerClipboard,
  pickComposerImages,
} from "../lib/composerImages";
import type { DraftComposerImageAttachment } from "../lib/composerImages";
import {
  mergeOptimisticThreadMessages,
  resolveOptimisticSendStartedAt,
} from "../lib/optimisticThreadSend";
import { scopedThreadKey } from "../lib/scopedEntities";
import { createThreadFeedBuilder } from "../lib/threadActivity";
import { recordThreadFeedBuildPerformanceSpan } from "../features/observability/threadPerformance";
import { appAtomRegistry } from "../state/atom-registry";
import {
  appendComposerDraftAttachments,
  appendComposerDraftText,
  clearComposerDraftContent,
  composerDraftsAtom,
  ensureComposerDraftsLoaded,
  getComposerDraftSnapshot,
  mergeComposerDraftContent,
  removeComposerDraftAttachment,
  setComposerDraftText,
  updateComposerDraftSettings,
  useComposerDraft,
} from "./use-composer-drafts";
import { useRemoteEnvironmentRuntime } from "../state/use-remote-environment-registry";
import { useSelectedThreadDetail } from "../state/use-thread-detail";
import { useThreadSelection } from "../state/use-thread-selection";
import {
  clearOptimisticStartingThread,
  useOptimisticStartingThread,
} from "./optimistic-thread-send";
import { enqueueThreadOutboxMessage } from "./thread-outbox";
import {
  dispatchingQueuedMessageIdAtom,
  retryingQueuedMessageIdsAtom,
} from "./use-thread-outbox-drain";
import { useThreadOutboxMessages } from "./use-thread-outbox";

export function appendReviewCommentToDraft(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly text: string;
  readonly attachments?: ReadonlyArray<DraftComposerImageAttachment>;
}): void {
  const threadKey = scopedThreadKey(input.environmentId, input.threadId);
  const existing = appAtomRegistry.get(composerDraftsAtom)[threadKey]?.text ?? "";
  const separator = existing.trim().length > 0 && !existing.endsWith("\n") ? "\n\n" : "";
  setComposerDraftText(threadKey, `${existing}${separator}${input.text}`);
  if (input.attachments && input.attachments.length > 0) {
    appendComposerDraftAttachments(threadKey, input.attachments);
  }
}

const EMPTY_THREAD_FEED_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = [];

export function useThreadDraftForThread(input: {
  readonly environmentId?: EnvironmentId;
  readonly threadId?: ThreadId;
}) {
  const threadKey =
    input.environmentId && input.threadId
      ? scopedThreadKey(input.environmentId, input.threadId)
      : null;
  const draft = useComposerDraft(threadKey);

  return {
    draftMessage: draft.text,
    draftAttachments: draft.attachments,
  };
}

export function useThreadComposerState() {
  const { selectedThread: selectedThreadShell } = useThreadSelection();
  const selectedThreadDetail = useSelectedThreadDetail();
  const composerDrafts = useAtomValue(composerDraftsAtom);
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const dispatchingQueuedMessageId = useAtomValue(dispatchingQueuedMessageIdAtom);
  const retryingQueuedMessageIds = useAtomValue(retryingQueuedMessageIdsAtom);
  const feedBuilder = useMemo(() => createThreadFeedBuilder(), []);

  useEffect(() => {
    ensureComposerDraftsLoaded();
  }, []);

  const selectedThreadKey = selectedThreadShell
    ? scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id)
    : null;
  const selectedThreadQueuedMessages = useMemo(
    () => (selectedThreadKey ? (queuedMessagesByThreadKey[selectedThreadKey] ?? []) : []),
    [queuedMessagesByThreadKey, selectedThreadKey],
  );
  const optimisticStarting = useOptimisticStartingThread({
    environmentId: selectedThreadShell?.environmentId ?? null,
    threadId: selectedThreadShell?.id ?? null,
  });
  const selectedEnvironmentRuntime = useRemoteEnvironmentRuntime(
    selectedThreadShell?.environmentId ?? null,
  );
  const selectedThreadMessages = selectedThreadDetail?.messages ?? null;
  const selectedThreadActivities = selectedThreadDetail?.activities ?? null;
  const selectedThreadFeedMessages = useMemo(
    () =>
      mergeOptimisticThreadMessages(
        selectedThreadMessages,
        selectedThreadQueuedMessages,
        optimisticStarting,
      ),
    [optimisticStarting, selectedThreadMessages, selectedThreadQueuedMessages],
  );
  const selectedThreadFeedBuild = useMemo(() => {
    if (
      selectedThreadMessages === null &&
      selectedThreadActivities === null &&
      selectedThreadFeedMessages.length === 0
    ) {
      return { feed: [], durationMs: 0 };
    }
    const startedAt = performance.now();
    const feed = feedBuilder({
      messages: selectedThreadFeedMessages,
      activities: selectedThreadActivities ?? EMPTY_THREAD_FEED_ACTIVITIES,
    });
    return { feed, durationMs: performance.now() - startedAt };
  }, [feedBuilder, selectedThreadActivities, selectedThreadFeedMessages, selectedThreadMessages]);
  const selectedThreadFeed = selectedThreadFeedBuild.feed;
  useEffect(() => {
    if (optimisticStarting === null || selectedThreadMessages === null) {
      return;
    }
    if (
      selectedThreadMessages.some((message) => message.id === optimisticStarting.message.messageId)
    ) {
      clearOptimisticStartingThread(optimisticStarting.environmentId, optimisticStarting.threadId);
    }
  }, [optimisticStarting, selectedThreadMessages]);
  useEffect(() => {
    if (!selectedThreadDetail || !selectedThreadShell) return;
    recordThreadFeedBuildPerformanceSpan(
      String(selectedThreadShell.environmentId),
      String(selectedThreadShell.id),
      {
        "thread.environmentId": String(selectedThreadShell.environmentId),
        "thread.id": String(selectedThreadShell.id),
        "thread.feed.durationMs": selectedThreadFeedBuild.durationMs,
        "thread.feed.entries": selectedThreadFeedBuild.feed.length,
        "thread.messages": selectedThreadDetail.messages.length,
        "thread.activities": selectedThreadDetail.activities.length,
      },
    );
  }, [selectedThreadDetail, selectedThreadFeedBuild, selectedThreadShell]);

  const selectedDraft = selectedThreadKey ? composerDrafts[selectedThreadKey] : null;
  const draftMessage = selectedDraft?.text ?? "";
  const draftAttachments = selectedDraft?.attachments ?? [];
  const selectedThreadQueueCount = selectedThreadQueuedMessages.length;
  const headQueuedMessageId = selectedThreadQueuedMessages[0]?.messageId ?? null;
  const isDeliveringQueuedMessage =
    dispatchingQueuedMessageId !== null &&
    selectedThreadQueuedMessages.some(
      (message) => message.messageId === dispatchingQueuedMessageId,
    );
  const isHeadQueuedMessageRetrying =
    headQueuedMessageId !== null && retryingQueuedMessageIds[headQueuedMessageId] === true;
  const selectedThread = selectedThreadDetail ?? selectedThreadShell;
  const modelSelection = selectedDraft?.modelSelection ?? selectedThread?.modelSelection ?? null;
  const runtimeMode = selectedDraft?.runtimeMode ?? selectedThread?.runtimeMode ?? null;
  const interactionMode = selectedDraft?.interactionMode ?? selectedThread?.interactionMode ?? null;

  const selectedThreadSessionActivity = useMemo(() => {
    const selectedThread = selectedThreadDetail ?? selectedThreadShell;
    if (!selectedThread?.session) {
      return null;
    }

    return {
      orchestrationStatus: selectedThread.session.status,
      activeTurnId: selectedThread.session.activeTurnId ?? undefined,
    };
  }, [selectedThreadDetail, selectedThreadShell]);

  const activeWorkStartedAt = useMemo(() => {
    const selectedThread = selectedThreadDetail ?? selectedThreadShell;
    if (!selectedThread) {
      return null;
    }

    const sendStartedAt = resolveOptimisticSendStartedAt({
      latestTurnStartedAt: selectedThread.latestTurn?.startedAt ?? null,
      latestTurnCompletedAt: selectedThread.latestTurn?.completedAt ?? null,
      sessionStatus: selectedThread.session?.status ?? null,
      sessionUpdatedAt: selectedThread.session?.updatedAt ?? null,
      optimisticSendStartedAt: optimisticStarting?.sendStartedAt ?? null,
      queuedHeadCreatedAt: selectedThreadQueuedMessages[0]?.createdAt ?? null,
      isDeliveringQueuedMessage,
      environmentConnected: selectedEnvironmentRuntime?.connectionState === "connected",
    });

    return deriveActiveWorkStartedAt(
      selectedThread.latestTurn,
      selectedThreadSessionActivity,
      sendStartedAt,
    );
  }, [
    isDeliveringQueuedMessage,
    optimisticStarting?.sendStartedAt,
    selectedEnvironmentRuntime?.connectionState,
    selectedThreadDetail,
    selectedThreadQueuedMessages,
    selectedThreadSessionActivity,
    selectedThreadShell,
  ]);

  const activeThreadBusy =
    !!selectedThread &&
    (selectedThread.session?.status === "running" ||
      selectedThread.session?.status === "starting" ||
      optimisticStarting !== null ||
      isDeliveringQueuedMessage);

  const onSendMessage = useCallback(async () => {
    if (!selectedThreadShell) {
      return null;
    }

    const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
    const draft = getComposerDraftSnapshot(threadKey);
    const thread = selectedThreadDetail ?? selectedThreadShell;
    const text = draft.text.trim();
    const attachments = draft.attachments;
    if (text.length === 0 && attachments.length === 0) {
      return null;
    }

    const metadata = makeQueuedMessageMetadata();
    const messageId = MessageId.make(metadata.messageId);
    // Enqueue publishes the queued atom synchronously (the durable write
    // happens behind it), so clearing the draft here gives send feedback on
    // the tap frame instead of after file I/O. If the write fails the message
    // is rolled out of the queue and the content is merged back into the
    // draft, preserving anything typed since.
    const enqueuePromise = enqueueThreadOutboxMessage({
      environmentId: selectedThreadShell.environmentId,
      threadId: selectedThreadShell.id,
      messageId,
      commandId: CommandId.make(metadata.commandId),
      text,
      attachments,
      modelSelection: draft.modelSelection ?? thread.modelSelection,
      runtimeMode: draft.runtimeMode ?? thread.runtimeMode,
      interactionMode: draft.interactionMode ?? thread.interactionMode,
      createdAt: metadata.createdAt,
    });
    clearComposerDraftContent(threadKey);
    enqueuePromise.catch((error: unknown) => {
      // Restore text via merge (idempotent) but attachments via the uncapped
      // append: the merge path slots existing attachments first and truncates
      // at the send limit, which would silently drop this message's images if
      // the user attached new ones while the write was in flight.
      void mergeComposerDraftContent(threadKey, { text, attachments: [] });
      appendComposerDraftAttachments(threadKey, attachments);
      Alert.alert(
        "Could not queue message",
        error instanceof Error ? error.message : "Failed to save the queued message.",
      );
    });
    return messageId;
  }, [selectedThreadDetail, selectedThreadShell]);

  const onChangeDraftMessage = useCallback(
    (value: string) => {
      if (!selectedThreadKey) {
        return;
      }

      setComposerDraftText(selectedThreadKey, value);
    },
    [selectedThreadKey],
  );

  const onPickDraftImages = useCallback(
    async (input?: {
      readonly onPicked?: (
        previews: ReadonlyArray<{ readonly id: string; readonly previewUri: string }>,
      ) => void;
    }) => {
      if (!selectedThreadShell) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      const result = await pickComposerImages({
        existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
        onPicked: input?.onPicked,
      });
      if (result.images.length > 0) {
        appendComposerDraftAttachments(threadKey, result.images);
      }
      if (result.error) {
        Alert.alert("Could not attach image", result.error);
      }
    },
    [composerDrafts, selectedThreadShell],
  );

  const onPasteIntoDraft = useCallback(async () => {
    if (!selectedThreadShell) {
      return;
    }

    const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
    const result = await pasteComposerClipboard({
      existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
    });
    if (result.images.length > 0) {
      appendComposerDraftAttachments(threadKey, result.images);
    }
    if (result.text) {
      appendComposerDraftText(threadKey, result.text);
    }
    if (result.error) {
      Alert.alert("Could not attach image", result.error);
    }
  }, [composerDrafts, selectedThreadShell]);

  const onNativePasteImages = useCallback(
    async (uris: ReadonlyArray<string>) => {
      if (!selectedThreadShell || uris.length === 0) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      try {
        const images = await convertPastedImagesToAttachments({
          uris,
          existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
        });
        if (images.length > 0) {
          appendComposerDraftAttachments(threadKey, images);
        }
      } catch (error) {
        console.error("[native paste] error converting images", {
          environmentId: selectedThreadShell.environmentId,
          threadId: selectedThreadShell.id,
          uriCount: uris.length,
          ...safeErrorLogAttributes(error),
        });
      }
    },
    [composerDrafts, selectedThreadShell],
  );

  const onRemoveDraftImage = useCallback(
    (imageId: string) => {
      if (!selectedThreadShell) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      removeComposerDraftAttachment(threadKey, imageId);
    },
    [selectedThreadShell],
  );

  const onUpdateModelSelection = useCallback(
    (value: ModelSelection) => {
      if (!selectedThreadKey) {
        return;
      }
      updateComposerDraftSettings(selectedThreadKey, { modelSelection: value });
    },
    [selectedThreadKey],
  );

  const onUpdateRuntimeMode = useCallback(
    (value: RuntimeMode) => {
      if (!selectedThreadKey) {
        return;
      }
      updateComposerDraftSettings(selectedThreadKey, { runtimeMode: value });
    },
    [selectedThreadKey],
  );

  const onUpdateInteractionMode = useCallback(
    (value: ProviderInteractionMode) => {
      if (!selectedThreadKey) {
        return;
      }
      updateComposerDraftSettings(selectedThreadKey, { interactionMode: value });
    },
    [selectedThreadKey],
  );

  return {
    selectedThreadFeed,
    selectedThreadQueueCount,
    headQueuedMessageId,
    isHeadQueuedMessageRetrying,
    isDeliveringQueuedMessage,
    activeWorkStartedAt,
    draftMessage,
    draftAttachments,
    modelSelection,
    runtimeMode,
    interactionMode,
    activeThreadBusy,
    onChangeDraftMessage,
    onPickDraftImages,
    onPasteIntoDraft,
    onNativePasteImages,
    onRemoveDraftImage,
    onSendMessage,
    onUpdateModelSelection,
    onUpdateRuntimeMode,
    onUpdateInteractionMode,
  };
}
