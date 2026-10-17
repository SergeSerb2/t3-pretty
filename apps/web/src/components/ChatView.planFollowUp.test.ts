import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { composerTargetKey, DraftId, useComposerDraftStore } from "../composerDraftStore";
import { threadContextRecord } from "../lib/composerContextRecords";
import { restorePlanFollowUpComposer, type PlanFollowUpComposerSnapshot } from "./ChatView.logic";

const sendingThread = {
  environmentId: EnvironmentId.make("sending-environment"),
  threadId: ThreadId.make("sending-thread"),
};

const snapshot: PlanFollowUpComposerSnapshot = {
  prompt: "Implement the plan with these constraints",
  terminalContexts: [
    {
      id: "terminal-context",
      threadId: sendingThread.threadId,
      terminalId: "terminal-1",
      terminalLabel: "Build",
      lineStart: 1,
      lineEnd: 1,
      text: "Build output",
      createdAt: "2026-10-16T00:00:00.000Z",
    },
  ],
  reviewComments: [
    {
      id: "review-context",
      sectionId: "file:src/app.ts",
      sectionTitle: "File comment",
      filePath: "src/app.ts",
      startIndex: 0,
      endIndex: 0,
      rangeLabel: "L1",
      text: "Keep this behavior",
      diff: "const enabled = true;",
    },
  ],
  previewAnnotations: [
    {
      id: "preview-context",
      pageUrl: "http://localhost:3000/",
      pageTitle: "App",
      comment: "Use this layout",
      elements: [],
      regions: [],
      strokes: [],
      styleChanges: [],
      screenshot: null,
      createdAt: "2026-10-16T00:00:00.000Z",
    },
  ],
  threadContexts: [threadContextRecord(sendingThread, "Original planning thread")],
};

function restore(options?: {
  readonly currentTargetKey?: () => string | null;
  readonly resetCursor?: Parameters<typeof restorePlanFollowUpComposer>[0]["resetCursor"];
}) {
  const store = useComposerDraftStore.getState();
  const input = {
    snapshot,
    currentDraft: store.getComposerDraft(sendingThread),
    targetKey: composerTargetKey(sendingThread),
    currentTargetKey: options?.currentTargetKey ?? (() => composerTargetKey(sendingThread)),
    writePrompt: (prompt: string) => store.setPrompt(sendingThread, prompt),
    writeTerminalContexts: (contexts: PlanFollowUpComposerSnapshot["terminalContexts"]) =>
      store.setTerminalContexts(sendingThread, [...contexts]),
    writeReviewComments: (comments: PlanFollowUpComposerSnapshot["reviewComments"]) =>
      store.setReviewComments(sendingThread, [...comments]),
    writePreviewAnnotations: (annotations: PlanFollowUpComposerSnapshot["previewAnnotations"]) =>
      store.setPreviewAnnotations(sendingThread, [...annotations]),
    writeThreadContexts: (contexts: PlanFollowUpComposerSnapshot["threadContexts"]) =>
      store.setThreadContexts(sendingThread, [...contexts]),
    resetCursor: options?.resetCursor ?? vi.fn(),
  };
  return restorePlanFollowUpComposer(input);
}

afterEach(() => {
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
});

describe("failed plan follow-up draft recovery", () => {
  it("keeps text typed while the request is in flight", async () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(sendingThread, snapshot.prompt);
    store.clearComposerContent(sendingThread);
    let rejectSend!: () => void;
    const failure = new Promise<void>((resolve) => {
      rejectSend = resolve;
    });
    const completion = failure.then(() => restore());

    store.setPrompt(sendingThread, "A new draft written during the request");
    rejectSend();
    await completion;

    expect(store.getComposerDraft(sendingThread)?.prompt).toBe(
      "A new draft written during the request",
    );
    expect(store.getComposerDraft(sendingThread)?.terminalContexts).toEqual([]);
  });

  it("keeps a new context even when the prompt is empty", () => {
    const store = useComposerDraftStore.getState();
    store.setTerminalContexts(sendingThread, [
      { ...snapshot.terminalContexts[0]!, id: "new-context" },
    ]);
    store.setPrompt(sendingThread, "");
    const newerDraft = store.getComposerDraft(sendingThread);

    restore();

    expect(store.getComposerDraft(sendingThread)).toBe(newerDraft);
  });

  it("restores the failed prompt and all context after the user clears a newer draft", () => {
    const store = useComposerDraftStore.getState();
    const destinationThread = {
      ...sendingThread,
      environmentId: EnvironmentId.make("other-environment"),
    };
    store.setPrompt(sendingThread, "A newer draft");
    store.setPrompt(destinationThread, "The destination's draft");
    const restoreAction = restore;

    expect(restoreAction()).toBe(false);
    expect(store.getComposerDraft(sendingThread)?.prompt).toBe("A newer draft");
    store.clearComposerContent(sendingThread);
    expect(restoreAction()).toBe(true);

    expect(store.getComposerDraft(sendingThread)).toMatchObject({
      prompt: expect.stringContaining(snapshot.prompt),
      terminalContexts: snapshot.terminalContexts,
      reviewComments: snapshot.reviewComments,
      previewAnnotations: snapshot.previewAnnotations,
      threadContexts: snapshot.threadContexts,
    });
    expect(store.getComposerDraft(destinationThread)?.prompt).toBe("The destination's draft");
    expect(restoreAction()).toBe(false);
  });

  it("restores the sending thread after navigation without changing the destination draft", () => {
    const store = useComposerDraftStore.getState();
    const destinationThread = {
      ...sendingThread,
      environmentId: EnvironmentId.make("other-environment"),
    };
    store.setPrompt(destinationThread, "The destination's draft");
    store.setInteractionMode(sendingThread, "default");

    restore();

    expect(store.getComposerDraft(sendingThread)).toMatchObject({
      prompt: expect.stringContaining(snapshot.prompt),
      terminalContexts: snapshot.terminalContexts,
      interactionMode: "default",
    });
    expect(store.getComposerDraft(destinationThread)?.prompt).toBe("The destination's draft");
  });

  it.each(["failure", "Restore action"] as const)(
    "keeps the queued editor's prompt and cursor when plan recovery follows %s",
    async (entry) => {
      const store = useComposerDraftStore.getState();
      const originalTargetKey = composerTargetKey(sendingThread);
      const queuedTarget = DraftId.make(`queued-edit:${originalTargetKey}:queued-run`);
      const currentTargetKey = { current: originalTargetKey };
      const promptRef = { current: snapshot.prompt };
      const cursor = { current: 0 };
      const terminalContextsRef = { current: [...snapshot.terminalContexts] };
      const restoreAction = () =>
        restore({
          currentTargetKey: () => currentTargetKey.current,
          resetCursor: (options) => {
            promptRef.current = options.prompt;
            cursor.current = options.cursor;
            terminalContextsRef.current = [...snapshot.terminalContexts];
          },
        });
      if (entry === "Restore action") {
        store.setPrompt(sendingThread, "A newer original draft");
        expect(restoreAction()).toBe(false);
        store.clearComposerContent(sendingThread);
      }
      let failSend!: () => void;
      const failure = new Promise<void>((resolve) => {
        failSend = resolve;
      });
      const completion = failure.then(restoreAction);

      // Queue editing changes the composer target while the route stays on this thread.
      store.setPrompt(queuedTarget, "The edited queued prompt");
      currentTargetKey.current = composerTargetKey(queuedTarget);
      promptRef.current = "The edited queued prompt";
      cursor.current = 7;
      terminalContextsRef.current = [];
      failSend();
      expect(await completion).toBe(true);

      expect(store.getComposerDraft(sendingThread)).toMatchObject({
        prompt: expect.stringContaining(snapshot.prompt),
        terminalContexts: snapshot.terminalContexts,
        reviewComments: snapshot.reviewComments,
        previewAnnotations: snapshot.previewAnnotations,
        threadContexts: snapshot.threadContexts,
      });
      expect(store.getComposerDraft(queuedTarget)?.prompt).toBe("The edited queued prompt");
      expect(promptRef.current).toBe("The edited queued prompt");
      expect(cursor.current).toBe(7);
      expect(terminalContextsRef.current).toEqual([]);
    },
  );
});
