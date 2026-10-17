import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { DraftId, useComposerDraftStore } from "./composerDraftStore";
import { releaseDraftAttachments } from "./lib/attachmentUploadQueue";

export function questionAttachmentDraftPrefix(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): string {
  return `${encodeURIComponent(JSON.stringify(environmentId))}:question-${encodeURIComponent(JSON.stringify(threadId))}-`;
}

export function questionAttachmentDraftId(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  requestId: string,
  questionId: string,
): DraftId {
  return DraftId.make(
    `${questionAttachmentDraftPrefix(environmentId, threadId)}${encodeURIComponent(JSON.stringify([requestId, questionId]))}`,
  );
}

export const useQuestionAttachmentPreparation = create<{ counts: Record<string, number> }>(() => ({
  counts: {},
}));

/** Count both staged files and in-flight preparation against the shared question limit. */
export function countQuestionAttachments(keys: ReadonlyArray<DraftId>): number {
  const store = useComposerDraftStore.getState();
  const { counts } = useQuestionAttachmentPreparation.getState();
  return keys.reduce((total, key) => {
    const draft = store.getComposerDraft(key);
    return total + (draft?.images.length ?? 0) + (draft?.files.length ?? 0) + (counts[key] ?? 0);
  }, 0);
}

export function changeQuestionAttachmentPreparation(key: DraftId, delta: number): void {
  useQuestionAttachmentPreparation.setState((state) =>
    delta < 0 && !(key in state.counts)
      ? state
      : {
          counts: { ...state.counts, [key]: Math.max(0, (state.counts[key] ?? 0) + delta) },
        },
  );
}

export function clearQuestionAttachmentDraft(key: DraftId): void {
  const store = useComposerDraftStore.getState();
  const draft = store.getComposerDraft(key);
  if (draft) {
    releaseDraftAttachments([...draft.images, ...draft.files]);
    for (const image of draft.images) {
      if (image.previewUrl.startsWith("blob:")) URL.revokeObjectURL(image.previewUrl);
    }
  }
  store.clearComposerContent(key);
  useQuestionAttachmentPreparation.setState(({ counts }) => {
    const next = { ...counts };
    delete next[key];
    return { counts: next };
  });
}

/** Discard answered questions only after the live thread confirms its pending requests. */
export function reconcileQuestionAttachmentDrafts(input: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  snapshotStatus: EnvironmentThreadStatus;
  pendingRequests: ReadonlyArray<{
    requestId: string;
    questions: ReadonlyArray<{ id: string }>;
  }> | null;
}): void {
  if (input.snapshotStatus !== "live" || input.pendingRequests === null) return;
  const prefix = questionAttachmentDraftPrefix(input.environmentId, input.threadId);
  const retained = new Set(
    input.pendingRequests.flatMap((request) =>
      request.questions.map((question) =>
        questionAttachmentDraftId(
          input.environmentId,
          input.threadId,
          request.requestId,
          question.id,
        ),
      ),
    ),
  );
  const keys = new Set([
    ...Object.keys(useComposerDraftStore.getState().draftsByThreadKey),
    ...Object.keys(useQuestionAttachmentPreparation.getState().counts),
  ]);
  for (const key of keys) {
    if (key.startsWith(prefix) && !retained.has(DraftId.make(key))) {
      clearQuestionAttachmentDraft(DraftId.make(key));
    }
  }
}
