import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import * as Cause from "effect/Cause";

import {
  CommandId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationThreadActivity,
  type ProviderInteractionMode,
  resolveRuntimeModeForProviderDriver,
  type RuntimeMode,
  type ThreadId,
  type TurnDeliveryMode,
} from "@t3tools/contracts";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import {
  codexFeedbackMessage,
  parseCodexFeedbackCommand,
  submitCodexFeedback,
  type CodexFeedbackSubmission,
} from "@t3tools/client-runtime/state/threads";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { deriveActiveWorkStartedAt } from "@t3tools/shared/orchestrationTiming";
import {
  isNativeResumeSessionReady,
  parseNativeResumeCommand,
  restoreFailedNativeResumePrompt,
} from "@t3tools/shared/nativeResume";

import { makeQueuedMessageMetadata } from "../lib/commandMetadata";
import {
  convertPastedImagesToAttachments,
  pasteComposerClipboard,
  pickComposerFiles,
  pickComposerMedia,
} from "../lib/composerImages";
import type { DraftComposerImageAttachment } from "../lib/composerImages";
import {
  isOptimisticStartingThreadPending,
  mergeOptimisticThreadMessages,
  resolveOptimisticSendStartedAt,
} from "../lib/optimisticThreadSend";
import { scopedThreadKey } from "../lib/scopedEntities";
import { copyTextWithHaptic } from "../lib/copyTextWithHaptic";
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
  scheduleUnusedComposerAttachmentCleanup,
  setComposerDraftText,
  updateComposerDraftSettings,
  useComposerDraft,
} from "./use-composer-drafts";
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
import { threadEnvironment } from "./threads";
import { useAtomCommand } from "./use-atom-command";
import {
  composerAttachmentUploadBlockReason,
  composerAttachmentUploadsAtom,
} from "./composer-attachment-uploads";

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
    // Capped: a review comment is new content, not a send-failure restore, so
    // it must not push the draft over the send limit. Overflow is released.
    const rejectedCount = appendComposerDraftAttachments(threadKey, input.attachments);
    if (rejectedCount > 0) {
      setPendingConnectionError(
        `${rejectedCount} comment attachment${rejectedCount === 1 ? " was" : "s were"} not added. Messages can contain at most ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments.`,
      );
    }
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
  const { selectedThread: selectedThreadShell, selectedEnvironmentRuntime } = useThreadSelection();
  const selectedThreadDetail = useSelectedThreadDetail();
  const composerDrafts = useAtomValue(composerDraftsAtom);
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const dispatchingQueuedMessageId = useAtomValue(dispatchingQueuedMessageIdAtom);
  const retryingQueuedMessageIds = useAtomValue(retryingQueuedMessageIdsAtom);
  const feedBuilder = useMemo(() => createThreadFeedBuilder(), []);
  const [feedbackSubmissionsByThreadKey, setFeedbackSubmissionsByThreadKey] = useState<
    Record<string, ReadonlyArray<CodexFeedbackSubmission>>
  >({});
  const uploadThreadFeedback = useAtomCommand(threadEnvironment.uploadFeedback, {
    reportFailure: false,
  });

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
  const selectedThreadMessages = selectedThreadDetail?.messages ?? null;
  const selectedThreadActivities = selectedThreadDetail?.activities ?? null;
  const selectedThreadFeedbackMessages = useMemo(() => {
    const submissions = selectedThreadKey
      ? (feedbackSubmissionsByThreadKey[selectedThreadKey] ?? [])
      : [];
    return submissions.flatMap((submission) =>
      submission.status === "interrupted"
        ? []
        : [codexFeedbackMessage(submission), codexFeedbackMessage(submission, "assistant")],
    );
  }, [feedbackSubmissionsByThreadKey, selectedThreadKey]);
  const selectedThreadFeedMessages = useMemo(
    () => [
      ...mergeOptimisticThreadMessages(
        selectedThreadMessages,
        selectedThreadQueuedMessages,
        optimisticStarting,
      ),
      ...selectedThreadFeedbackMessages,
    ],
    [
      optimisticStarting,
      selectedThreadFeedbackMessages,
      selectedThreadMessages,
      selectedThreadQueuedMessages,
    ],
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
    const nativeResume = parseNativeResumeCommand(optimisticStarting.message.text);
    const nativeResumeSettled =
      selectedThreadMessages.length === 0 &&
      nativeResume?._tag === "Resume" &&
      (isNativeResumeSessionReady(selectedThreadDetail?.session?.status) ||
        selectedThreadDetail?.session?.status === "error");
    if (
      selectedThreadMessages.some(
        (message) => message.id === optimisticStarting.message.messageId,
      ) ||
      nativeResumeSettled
    ) {
      if (nativeResumeSettled && selectedThreadDetail?.session?.status === "error") {
        const threadKey = scopedThreadKey(
          optimisticStarting.environmentId,
          optimisticStarting.threadId,
        );
        const retryPrompt = restoreFailedNativeResumePrompt(
          getComposerDraftSnapshot(threadKey).text,
          [optimisticStarting.message.text],
        );
        if (retryPrompt !== null) {
          setComposerDraftText(threadKey, retryPrompt);
        }
      }
      clearOptimisticStartingThread(optimisticStarting.environmentId, optimisticStarting.threadId);
    }
  }, [optimisticStarting, selectedThreadDetail?.session, selectedThreadMessages]);
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
      isOptimisticStartingThreadPending(optimisticStarting, selectedThread.session?.status) ||
      isDeliveringQueuedMessage);

  const onSendMessage = useCallback(
    async (delivery?: TurnDeliveryMode) => {
      if (!selectedThreadShell) {
        return null;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      const draft = getComposerDraftSnapshot(threadKey);
      const thread = selectedThreadDetail ?? selectedThreadShell;
      const text = draft.text.trim();
      const attachments = draft.attachments;
      if (
        composerAttachmentUploadBlockReason({
          environmentId: selectedThreadShell.environmentId,
          attachments,
          connected: selectedEnvironmentRuntime?.connectionState === "connected",
          serverConfig: selectedEnvironmentRuntime?.serverConfig ?? null,
          states: appAtomRegistry.get(composerAttachmentUploadsAtom),
        }) !== null
      ) {
        return null;
      }
      if (text.length === 0 && attachments.length === 0) {
        return null;
      }
      // A send-failure restore appends with allowOverflow so it never drops the
      // user's files, which can leave the draft over the cap. Sending it anyway
      // would enqueue a message that outbox recovery rejects forever, so block
      // here until the user removes attachments.
      if (attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
        Alert.alert(
          "Too many attachments",
          `Remove attachments until there are at most ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}.`,
        );
        return null;
      }

      const sendModelSelection = draft.modelSelection ?? thread.modelSelection;
      const sendProvider = selectedEnvironmentRuntime?.serverConfig?.providers.find(
        (provider) => provider.instanceId === sendModelSelection.instanceId,
      );
      const sendProviderDriver = sendProvider?.driver ?? null;
      const feedbackCommand =
        attachments.length === 0 &&
        (sendProviderDriver === "codex" || thread.session?.providerName === "codex")
          ? parseCodexFeedbackCommand(text)
          : null;
      if (feedbackCommand) {
        if (thread.session === null) {
          Alert.alert("Start a Codex thread first", "Send a message before you submit feedback.");
          return null;
        }
        const metadata = makeQueuedMessageMetadata();
        const result = await submitCodexFeedback({
          submission: {
            id: MessageId.make(metadata.messageId),
            command: text,
            createdAt: metadata.createdAt,
          },
          clearDraft: () => clearComposerDraftContent(threadKey),
          onUpdate: (submission) => {
            setFeedbackSubmissionsByThreadKey((current) => {
              const existing = current[threadKey] ?? [];
              const found = existing.some((entry) => entry.id === submission.id);
              return {
                ...current,
                [threadKey]: found
                  ? existing.map((entry) => (entry.id === submission.id ? submission : entry))
                  : [...existing, submission],
              };
            });
          },
          upload: () =>
            uploadThreadFeedback({
              environmentId: selectedThreadShell.environmentId,
              input: {
                threadId: selectedThreadShell.id,
                ...feedbackCommand,
              },
            }),
        });
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) {
            return null;
          }
          const error = Cause.squash(result.cause);
          Alert.alert(
            "Could not send feedback to OpenAI",
            error instanceof Error ? error.message : "An error occurred.",
          );
          return null;
        }
        const feedbackId = result.value.feedbackId;
        Alert.alert("Feedback sent to OpenAI", `Thread ID: ${feedbackId}`, [
          { text: "OK", style: "cancel" },
          {
            text: "Copy ID",
            onPress: () => copyTextWithHaptic(feedbackId, { target: "Codex feedback thread ID" }),
          },
        ]);
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
        modelSelection: sendModelSelection,
        runtimeMode: resolveRuntimeModeForProviderDriver(
          sendProviderDriver,
          draft.runtimeMode ?? thread.runtimeMode,
        ),
        interactionMode: draft.interactionMode ?? thread.interactionMode,
        createdAt: metadata.createdAt,
        ...(delivery ? { delivery } : {}),
      });
      clearComposerDraftContent(threadKey, { deferAttachmentCleanup: true });
      enqueuePromise.then(
        () => {
          // The queued message owns the files now; the sweep sees that and
          // spares them. Deferred to here so a failed write cannot roll the
          // message out of the queue mid-sweep and lose the bytes.
          scheduleUnusedComposerAttachmentCleanup(attachments);
        },
        (error: unknown) => {
          // Restore text via merge (idempotent) but attachments via the uncapped
          // append: the merge path slots existing attachments first and truncates
          // at the send limit, which would silently drop this message's images if
          // the user attached new ones while the write was in flight.
          void mergeComposerDraftContent(threadKey, { text, attachments: [] });
          appendComposerDraftAttachments(threadKey, attachments, { allowOverflow: true });
          Alert.alert(
            "Could not queue message",
            error instanceof Error ? error.message : "Failed to save the queued message.",
          );
        },
      );
      return messageId;
    },
    [
      selectedEnvironmentRuntime?.connectionState,
      selectedEnvironmentRuntime?.serverConfig,
      selectedThreadDetail,
      selectedThreadShell,
      uploadThreadFeedback,
    ],
  );

  const onChangeDraftMessage = useCallback(
    (value: string) => {
      if (!selectedThreadKey) {
        return;
      }

      setComposerDraftText(selectedThreadKey, value);
    },
    [selectedThreadKey],
  );

  const onPickDraftMedia = useCallback(
    async (input?: {
      readonly onPicked?: (
        previews: ReadonlyArray<{ readonly id: string; readonly previewUri: string }>,
      ) => void;
    }) => {
      if (!selectedThreadShell) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      const capabilities = selectedEnvironmentRuntime?.serverConfig?.environment.capabilities;
      const result = await pickComposerMedia({
        existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
        maxVideoBytes:
          capabilities?.attachmentUploads === true
            ? capabilities.fileAttachments?.maxUploadBytes
            : undefined,
        onPicked: input?.onPicked,
      });
      const rejectedCount = appendComposerDraftAttachments(threadKey, result.attachments);
      const problems = [
        ...(result.error ? [result.error] : []),
        ...(rejectedCount > 0
          ? [`You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments per message.`]
          : []),
      ];
      if (problems.length > 0) {
        Alert.alert("Could not attach photo or video", problems.join("\n\n"));
      }
    },
    [composerDrafts, selectedEnvironmentRuntime?.serverConfig, selectedThreadShell],
  );

  const onPickDraftFiles = useCallback(async () => {
    if (!selectedThreadShell) {
      return;
    }
    const maxBytes =
      selectedEnvironmentRuntime?.serverConfig?.environment.capabilities.fileAttachments
        ?.maxUploadBytes;
    if (maxBytes === undefined) {
      Alert.alert("Could not attach file", "This server does not support file attachments.");
      return;
    }

    const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
    // pickComposerFiles clamps the advertised limit to the contract maximum.
    const result = await pickComposerFiles({
      existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
      maxBytes,
    });
    const rejectedCount = appendComposerDraftAttachments(threadKey, result.files);
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
  }, [composerDrafts, selectedEnvironmentRuntime?.serverConfig, selectedThreadShell]);

  const onPasteIntoDraft = useCallback(async () => {
    if (!selectedThreadShell) {
      return;
    }

    const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
    const result = await pasteComposerClipboard({
      existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
    });
    const rejectedPasteCount = appendComposerDraftAttachments(threadKey, result.images);
    if (result.text) {
      appendComposerDraftText(threadKey, result.text);
    }
    if (result.error) {
      Alert.alert("Could not attach image", result.error);
    } else if (rejectedPasteCount > 0) {
      Alert.alert(
        "Could not attach image",
        `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`,
      );

    }
  }, [composerDrafts, selectedThreadShell]);

  const onNativePasteImages = useCallback(
    async (uris: ReadonlyArray<string>) => {
      if (!selectedThreadShell || uris.length === 0) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      try {
        const result = await convertPastedImagesToAttachments({
          uris,
          existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
        });
        if (result.images.length > 0) {
          appendComposerDraftAttachments(threadKey, result.images);
        }
        if (result.error) {
          Alert.alert("Could not attach image", result.error);
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
    onPickDraftMedia,
    onPickDraftFiles,
    onPasteIntoDraft,
    onNativePasteImages,
    onRemoveDraftImage,
    onSendMessage,
    onUpdateModelSelection,
    onUpdateRuntimeMode,
    onUpdateInteractionMode,
  };
}
