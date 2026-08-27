import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Thread, ThreadShell } from "../types";
import {
  MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  branchMismatchKey,
  buildExpiredTerminalContextToastCopy,
  buildLoadingThreadFromShell,
  buildThreadTurnInterruptInput,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  dismissBranchMismatchForSession,
  ENVIRONMENT_RECONNECT_WARNING_GRACE_MS,
  getStartedThreadModelChangeBlockReason,
  hasEnvironmentReconnectWarningGraceElapsed,
  hasOptimisticWorkingSettled,
  hasServerAcknowledgedLocalDispatch,
  isBranchMismatchDismissedForSession,
  reconcileQueuedComposerMessages,
  reconcileMountedTerminalThreadIds,
  reconcileRetainedMountedThreadIds,
  resolveBackgroundDraftWorkspaceOptions,
  resolveDraftPromotionNavigationTarget,
  resolveThreadMetadataUpdateForNextTurn,
  resolveCarriedRuntimeMode,
  resolveCarriedComposerRuntimeMode,
  resolveComposerRuntimeMode,
  resolveSendEnvMode,
  resolveDraftHeroState,
  restoreFailedNativeResumePrompt,
  storedComposerRuntimeMode,
  scheduleEnvironmentReconnectWarning,
  startNewThreadForProject,
  shouldDockDraftHeroForSubmission,
  shouldReleaseTimelineAnchorForToolActivity,
  shouldResetComposerQueueForRouteChange,
  shouldShowBranchMismatchBanner,
  shouldWriteThreadErrorToCurrentServerThread,
} from "./ChatView.logic";

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("thread-1");
const now = "2026-03-29T00:00:00.000Z";

describe("restoreFailedNativeResumePrompt", () => {
  it("restores only the latest failed resume ahead of new draft text", () => {
    expect(
      restoreFailedNativeResumePrompt("new draft", [
        "/resume old-session",
        "ordinary prompt",
        "/resume corrected-session",
      ]),
    ).toBe("/resume corrected-session\n\nnew draft");
    expect(restoreFailedNativeResumePrompt("", ["ordinary prompt"])).toBeNull();
  });
});

describe("draft hero submission transition", () => {
  it("does not dock the composer before a background submission", () => {
    expect(
      shouldDockDraftHeroForSubmission({
        isDraftHeroState: true,
        activeThreadKey: "environment-local:thread-1",
        submissionIntent: "background",
      }),
    ).toBe(false);
  });

  it("keeps the composer in the hero layout until navigation after server promotion", () => {
    expect(
      resolveDraftHeroState({
        isLocalDraftThread: false,
        hasTimelineEntries: true,
        isWorking: true,
        draftHeroDockRequested: false,
        backgroundSubmissionPending: true,
      }),
    ).toBe(true);
  });

  it("does not auto-navigate a background submission after server promotion", () => {
    expect(
      resolveDraftPromotionNavigationTarget({
        serverThreadRef: { environmentId, threadId },
        serverThreadStarted: true,
        backgroundSubmissionPending: true,
      }),
    ).toBeNull();
  });
});

describe("shouldReleaseTimelineAnchorForToolActivity", () => {
  const activeTurnId = TurnId.make("active-turn");
  const anchorMessageId = MessageId.make("anchored-message");
  const activeToolEntry = {
    id: "tool-entry",
    kind: "work" as const,
    createdAt: now,
    entry: {
      id: "active-tool",
      createdAt: now,
      turnId: activeTurnId,
      label: "Run command",
      tone: "tool" as const,
      command: "git status",
    },
  };

  it("releases the send anchor for tool activity in the active turn", () => {
    expect(
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId,
        liveFollowEnabled: true,
        runningTurnId: activeTurnId,
        timelineEntries: [activeToolEntry],
      }),
    ).toBe(true);
  });

  it("keeps the anchor while the user reads history", () => {
    expect(
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId,
        liveFollowEnabled: false,
        runningTurnId: activeTurnId,
        timelineEntries: [activeToolEntry],
      }),
    ).toBe(false);
  });

  it("ignores tool activity from earlier turns", () => {
    expect(
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId,
        liveFollowEnabled: true,
        runningTurnId: activeTurnId,
        timelineEntries: [
          {
            ...activeToolEntry,
            entry: {
              ...activeToolEntry.entry,
              turnId: TurnId.make("previous-turn"),
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("ignores thinking and error rows without tool activity", () => {
    expect(
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId,
        liveFollowEnabled: true,
        runningTurnId: activeTurnId,
        timelineEntries: [
          {
            ...activeToolEntry,
            entry: {
              id: "thinking-entry",
              createdAt: now,
              turnId: activeTurnId,
              label: "Thinking",
              tone: "thinking",
            },
          },
          {
            ...activeToolEntry,
            id: "error-entry",
            entry: {
              id: "error-entry",
              createdAt: now,
              turnId: activeTurnId,
              label: "Provider error",
              tone: "error",
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("does nothing without an anchor or running turn", () => {
    const input = {
      anchorMessageId,
      liveFollowEnabled: true,
      runningTurnId: activeTurnId,
      timelineEntries: [activeToolEntry],
    };

    expect(shouldReleaseTimelineAnchorForToolActivity({ ...input, anchorMessageId: null })).toBe(
      false,
    );
    expect(shouldReleaseTimelineAnchorForToolActivity({ ...input, runningTurnId: null })).toBe(
      false,
    );
  });
});

describe("environment reconnect warning grace", () => {
  afterEach(() => vi.useRealTimers());

  it("shows a persistent reconnect after the grace period", () => {
    vi.useFakeTimers();
    const showWarning = vi.fn();

    scheduleEnvironmentReconnectWarning(showWarning);
    vi.advanceTimersByTime(ENVIRONMENT_RECONNECT_WARNING_GRACE_MS - 1);
    expect(showWarning).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(showWarning).toHaveBeenCalledOnce();
  });

  it("cancels the warning when the connection recovers during the grace period", () => {
    vi.useFakeTimers();
    const showWarning = vi.fn();

    const cancel = scheduleEnvironmentReconnectWarning(showWarning);
    cancel();
    vi.advanceTimersByTime(ENVIRONMENT_RECONNECT_WARNING_GRACE_MS);

    expect(showWarning).not.toHaveBeenCalled();
  });

  it("does not reuse elapsed grace from another environment", () => {
    const anotherEnvironmentId = EnvironmentId.make("environment-remote");

    expect(hasEnvironmentReconnectWarningGraceElapsed(environmentId, environmentId)).toBe(true);
    expect(hasEnvironmentReconnectWarningGraceElapsed(anotherEnvironmentId, environmentId)).toBe(
      false,
    );
  });
});

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: threadId,
    environmentId,
    enabledSkillIds: [],
    projectId,
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

const completedTurn = {
  turnId: TurnId.make("turn-1"),
  state: "completed" as const,
  requestedAt: now,
  startedAt: "2026-03-29T00:00:01.000Z",
  completedAt: "2026-03-29T00:00:10.000Z",
  assistantMessageId: null,
};

const readySession = {
  threadId,
  status: "ready" as const,
  providerName: "codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: "full-access" as const,
  activeTurnId: null,
  lastError: null,
  updatedAt: "2026-03-29T00:00:10.000Z",
};

describe("buildLoadingThreadFromShell", () => {
  it("preserves shell metadata and supplies empty detail collections", () => {
    const shell = {
      environmentId,
      id: threadId,
      projectId,
      title: "Loading thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      session: null,
      latestUserMessageAt: now,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
      enabledSkillIds: [],
    } satisfies ThreadShell;

    expect(buildLoadingThreadFromShell(shell)).toMatchObject({
      environmentId,
      id: threadId,
      projectId,
      title: "Loading thread",
      branch: "main",
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    });
  });
});

describe("resolveThreadMetadataUpdateForNextTurn", () => {
  const modelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  };

  it("updates a stale local thread branch to the active checkout", () => {
    expect(
      resolveThreadMetadataUpdateForNextTurn({
        currentModelSelection: modelSelection,
        currentBranch: "feature/thread",
        nextBranch: "feature/checkout",
      }),
    ).toEqual({ branch: "feature/checkout", worktreePath: null });
  });

  it("does not write metadata when the model and branch are unchanged", () => {
    expect(
      resolveThreadMetadataUpdateForNextTurn({
        currentModelSelection: modelSelection,
        nextModelSelection: modelSelection,
        currentBranch: "feature/current",
        nextBranch: "feature/current",
      }),
    ).toBeNull();
  });
});

describe("buildThreadTurnInterruptInput", () => {
  it("targets the session's active running turn", () => {
    const activeTurnId = TurnId.make("turn-running");

    expect(
      buildThreadTurnInterruptInput(
        makeThread({
          session: {
            ...readySession,
            status: "running",
            activeTurnId,
          },
        }),
      ),
    ).toEqual({ threadId, turnId: activeTurnId });
  });

  it("omits a turn id when the session is not running", () => {
    expect(buildThreadTurnInterruptInput(makeThread({ session: readySession }))).toEqual({
      threadId,
    });
  });
});

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId,
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: now,
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId,
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: now,
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });

  it("treats element contexts as sendable content (no text, no images, no terminals)", () => {
    const state = deriveComposerSendState({
      prompt: "",
      imageCount: 0,
      terminalContexts: [],
      elementContextCount: 1,
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.expiredTerminalContextCount).toBe(0);
    expect(state.hasSendableContent).toBe(true);
  });

  it("does NOT treat zero element contexts as sendable", () => {
    expect(
      deriveComposerSendState({
        prompt: "",
        imageCount: 0,
        terminalContexts: [],
        elementContextCount: 0,
      }).hasSendableContent,
    ).toBe(false);
  });

  it("treats pending path attachments as sendable content", () => {
    expect(
      deriveComposerSendState({
        prompt: "",
        imageCount: 0,
        terminalContexts: [],
        fileAttachmentCount: 1,
      }).hasSendableContent,
    ).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats empty and omission guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("getStartedThreadModelChangeBlockReason", () => {
  const providers = [
    {
      instanceId: ProviderInstanceId.make("codex"),
    },
    {
      instanceId: ProviderInstanceId.make("grok"),
      requiresNewThreadForModelChange: true,
    },
  ];

  it("allows model changes before a provider session has started", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: false,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-other",
        },
      }),
    ).toBeNull();
  });

  it("allows unchanged model selections for restricted providers", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: true,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
      }),
    ).toBeNull();
  });

  it("blocks started-session model changes when either provider requires a new thread", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: true,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
      }),
    ).toEqual({
      title: "Start a new chat to change models",
      description:
        "This provider does not allow switching models after a conversation has started.",
    });
  });

  it("allows switching away from a restricted provider when handoff is supported", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: true,
        supportsProviderHandoff: true,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
      }),
    ).toBeNull();
  });

  it("still blocks restricted same-provider model changes when handoff is supported", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: true,
        supportsProviderHandoff: true,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-other",
        },
      }),
    ).not.toBeNull();
  });
});

describe("resolveSendEnvMode", () => {
  it("keeps worktree mode only for git repositories", () => {
    expect(resolveSendEnvMode({ requestedEnvMode: "worktree", isGitRepo: true })).toBe("worktree");
    expect(resolveSendEnvMode({ requestedEnvMode: "worktree", isGitRepo: false })).toBe("local");
  });
});

describe("resolveBackgroundDraftWorkspaceOptions", () => {
  it("keeps New worktree selected without reusing the launched worktree", () => {
    expect(
      resolveBackgroundDraftWorkspaceOptions({
        envMode: "worktree",
        branch: "main",
        startFromOrigin: true,
      }),
    ).toEqual({
      envMode: "worktree",
      branch: "main",
      worktreePath: null,
      startFromOrigin: true,
    });
  });
});

describe("branchMismatchKey", () => {
  it("builds a key from thread id and both branches", () => {
    expect(branchMismatchKey("thread-1", { threadBranch: "feat/a", currentBranch: "feat/b" })).toBe(
      "thread-1:feat/a:feat/b",
    );
  });

  it("returns null without a thread or mismatch", () => {
    expect(branchMismatchKey(null, { threadBranch: "a", currentBranch: "b" })).toBeNull();
    expect(branchMismatchKey("thread-1", null)).toBeNull();
  });
});

describe("shouldShowBranchMismatchBanner", () => {
  const base = {
    hasMismatch: true,
    isDismissed: false,
    composerHasContent: false,
    wasShownForCurrentMismatch: false,
  };

  it("stays hidden during passive browsing (even though the composer autofocuses)", () => {
    expect(shouldShowBranchMismatchBanner(base)).toBe(false);
  });

  it("shows once the composer has draft content", () => {
    expect(shouldShowBranchMismatchBanner({ ...base, composerHasContent: true })).toBe(true);
  });

  it("stays mounted after the draft clears once shown for the current mismatch", () => {
    expect(shouldShowBranchMismatchBanner({ ...base, wasShownForCurrentMismatch: true })).toBe(
      true,
    );
  });

  it("never shows when dismissed or without a mismatch", () => {
    expect(
      shouldShowBranchMismatchBanner({ ...base, composerHasContent: true, isDismissed: true }),
    ).toBe(false);
    expect(
      shouldShowBranchMismatchBanner({ ...base, composerHasContent: true, hasMismatch: false }),
    ).toBe(false);
  });
});

describe("session branch mismatch dismissal", () => {
  it("tracks dismissed keys and treats other keys as active", () => {
    expect(isBranchMismatchDismissedForSession("t1:a:b")).toBe(false);
    dismissBranchMismatchForSession("t1:a:b");
    expect(isBranchMismatchDismissedForSession("t1:a:b")).toBe(true);
    expect(isBranchMismatchDismissedForSession("t1:a:c")).toBe(false);
    expect(isBranchMismatchDismissedForSession(null)).toBe(false);
  });
});

describe("reconcileMountedTerminalThreadIds", () => {
  it("keeps open threads and makes the active thread most recent", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: ["thread-a", "thread-b", "thread-c"],
        openThreadIds: ["thread-a", "thread-b", "thread-c"],
        activeThreadId: "thread-a",
        activeThreadTerminalOpen: true,
        maxHiddenThreadCount: 2,
      }),
    ).toEqual(["thread-b", "thread-c", "thread-a"]);
  });

  it("drops closed threads and enforces the hidden mounted cap", () => {
    const ids = Array.from(
      { length: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS + 2 },
      (_, index) => `thread-${index}`,
    );
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: ids,
        openThreadIds: ids.slice(1),
        activeThreadId: null,
        activeThreadTerminalOpen: false,
      }),
    ).toEqual(ids.slice(-MAX_HIDDEN_MOUNTED_TERMINAL_THREADS));
  });

  it("retains the active terminal while its close transition exits", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: ["thread-a"],
        openThreadIds: [],
        activeThreadId: "thread-a",
        activeThreadTerminalOpen: false,
        activeThreadTerminalExiting: true,
      }),
    ).toEqual(["thread-a"]);
  });
});

describe("reconcileRetainedMountedThreadIds", () => {
  it("retains hidden open threads and adds the active open thread", () => {
    expect(
      reconcileRetainedMountedThreadIds({
        currentThreadIds: [ThreadId.make("thread-hidden")],
        openThreadIds: [ThreadId.make("thread-hidden")],
        activeThreadId: ThreadId.make("thread-active"),
        activeThreadOpen: true,
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
      }),
    ).toEqual([ThreadId.make("thread-hidden"), ThreadId.make("thread-active")]);
  });

  it("can retain the active thread as hidden when it is inactive", () => {
    expect(
      reconcileRetainedMountedThreadIds({
        currentThreadIds: [ThreadId.make("thread-active")],
        openThreadIds: [ThreadId.make("thread-active")],
        activeThreadId: ThreadId.make("thread-active"),
        activeThreadOpen: false,
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
        retainInactiveActiveThread: true,
      }),
    ).toEqual([ThreadId.make("thread-active")]);
  });

  it("evicts the oldest hidden threads beyond the configured cap", () => {
    const currentThreadIds = Array.from(
      { length: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS + 2 },
      (_, index) => ThreadId.make(`thread-${index + 1}`),
    );

    expect(
      reconcileRetainedMountedThreadIds({
        currentThreadIds,
        openThreadIds: currentThreadIds,
        activeThreadId: null,
        activeThreadOpen: false,
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
      }),
    ).toEqual(currentThreadIds.slice(-MAX_HIDDEN_MOUNTED_PREVIEW_THREADS));
  });
});

describe("shouldWriteThreadErrorToCurrentServerThread", () => {
  it("writes errors for a shell-derived active server thread", () => {
    const routeThreadRef = { environmentId, threadId };

    expect(
      shouldWriteThreadErrorToCurrentServerThread({
        activeServerThread: { environmentId, id: threadId },
        routeThreadRef,
        targetThreadId: threadId,
      }),
    ).toBe(true);
  });

  it("requires an active server thread matching the environment, route, and target", () => {
    const routeThreadRef = { environmentId, threadId };

    expect(
      shouldWriteThreadErrorToCurrentServerThread({
        activeServerThread: null,
        routeThreadRef,
        targetThreadId: threadId,
      }),
    ).toBe(false);
  });
});

describe("startNewThreadForProject", () => {
  it("starts a thread through the supplied shared handler for the active project", () => {
    const calls: Array<{ environmentId: EnvironmentId; projectId: ProjectId }> = [];
    const projectRef = { environmentId, projectId };

    expect(
      startNewThreadForProject(projectRef, (nextProjectRef) => {
        calls.push(nextProjectRef);
        return Promise.resolve();
      }),
    ).toBe(true);
    expect(calls).toEqual([projectRef]);
  });

  it("does nothing when the active project is unavailable", () => {
    let called = false;

    expect(
      startNewThreadForProject(null, () => {
        called = true;
        return Promise.resolve();
      }),
    ).toBe(false);
    expect(called).toBe(false);
  });
});

describe("hasServerAcknowledgedLocalDispatch", () => {
  it("does not acknowledge unchanged server state", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: completedTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: readySession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("keeps a follow-up active while its provider session is starting", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "connecting",
        latestTurn: completedTurn,
        latestUserMessageId: MessageId.make("message-followup"),
        session: {
          ...readySession,
          status: "starting",
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("acknowledges a settled newer turn", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );
    const newerTurn = {
      ...completedTurn,
      turnId: TurnId.make("turn-2"),
      requestedAt: "2026-03-29T00:01:00.000Z",
      startedAt: "2026-03-29T00:01:01.000Z",
      completedAt: "2026-03-29T00:01:30.000Z",
    };

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: newerTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: { ...readySession, updatedAt: newerTurn.completedAt },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("waits for the matching running turn before acknowledging", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );
    const runningTurn = {
      ...completedTurn,
      turnId: TurnId.make("turn-2"),
      state: "running" as const,
      requestedAt: "2026-03-29T00:01:00.000Z",
      startedAt: "2026-03-29T00:01:01.000Z",
      completedAt: null,
    };

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: runningTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: {
          ...readySession,
          status: "running",
          activeTurnId: TurnId.make("turn-other"),
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: runningTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: {
          ...readySession,
          status: "running",
          activeTurnId: runningTurn.turnId,
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("acknowledges a steering message projected onto the current running turn", () => {
    const runningTurn = {
      ...completedTurn,
      state: "running" as const,
      completedAt: null,
    };
    const runningSession = {
      ...readySession,
      status: "running" as const,
      activeTurnId: runningTurn.turnId,
    };
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({
        latestTurn: runningTurn,
        session: runningSession,
        messages: [
          {
            id: MessageId.make("message-before-steer"),
            role: "user",
            text: "Initial prompt",
            turnId: runningTurn.turnId,
            createdAt: runningTurn.requestedAt,
            updatedAt: runningTurn.requestedAt,
            streaming: false,
          },
        ],
      }),
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: runningTurn,
        latestUserMessageId: MessageId.make("message-steer"),
        session: runningSession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("acknowledges pending user interaction and errors immediately", () => {
    const localDispatch = createLocalDispatchSnapshot(makeThread());
    const common = {
      localDispatch,
      phase: "ready" as const,
      latestTurn: null,
      latestUserMessageId: localDispatch.latestUserMessageId,
      session: null,
      hasPendingApproval: false,
      hasPendingUserInput: false,
      threadError: null,
    };

    expect(hasServerAcknowledgedLocalDispatch({ ...common, hasPendingApproval: true })).toBe(true);
    expect(hasServerAcknowledgedLocalDispatch({ ...common, hasPendingUserInput: true })).toBe(true);
    expect(hasServerAcknowledgedLocalDispatch({ ...common, threadError: "failed" })).toBe(true);
  });
});

describe("reconcileQueuedComposerMessages", () => {
  const queuedMessages = [
    {
      id: MessageId.make("message-queued-1"),
      text: "First queued follow-up",
      attachmentCount: 0,
    },
    {
      id: MessageId.make("message-queued-2"),
      text: "Second queued follow-up",
      attachmentCount: 1,
    },
  ];

  it("holds queued copy until the server identifies its turn", () => {
    expect(
      reconcileQueuedComposerMessages({
        queuedMessages,
        serverMessages: [],
        latestTurn: { ...completedTurn, turnId: TurnId.make("turn-other"), state: "running" },
      }),
    ).toBe(queuedMessages);
  });

  it("releases through the queued message identified by the server", () => {
    expect(
      reconcileQueuedComposerMessages({
        queuedMessages,
        serverMessages: [],
        latestTurn: {
          ...completedTurn,
          turnId: TurnId.make("turn-next"),
          userMessageId: queuedMessages[1]!.id,
          state: "running",
        },
      }),
    ).toEqual([]);
  });

  it("releases a queued message after its turn finishes before reconciliation", () => {
    expect(
      reconcileQueuedComposerMessages({
        queuedMessages,
        serverMessages: [],
        latestTurn: { ...completedTurn, userMessageId: queuedMessages[0]!.id },
      }),
    ).toEqual([queuedMessages[1]]);
  });

  it("falls back to the matching server message for older snapshots", () => {
    expect(
      reconcileQueuedComposerMessages({
        queuedMessages,
        serverMessages: [
          {
            id: queuedMessages[1]!.id,
            role: "user",
            text: queuedMessages[1]!.text,
            turnId: null,
            createdAt: completedTurn.requestedAt,
            updatedAt: completedTurn.requestedAt,
            streaming: false,
          },
        ],
        latestTurn: completedTurn,
      }),
    ).toEqual([]);
  });

  it("does not use the fallback when the server identifies another message", () => {
    expect(
      reconcileQueuedComposerMessages({
        queuedMessages,
        serverMessages: [
          {
            id: queuedMessages[0]!.id,
            role: "user",
            text: queuedMessages[0]!.text,
            turnId: null,
            createdAt: completedTurn.requestedAt,
            updatedAt: completedTurn.requestedAt,
            streaming: false,
          },
        ],
        latestTurn: { ...completedTurn, userMessageId: MessageId.make("message-other-client") },
      }),
    ).toBe(queuedMessages);
  });
});

describe("shouldResetComposerQueueForRouteChange", () => {
  const draft = { routeKind: "draft" as const, routeThreadKey: "env:thread", draftId: "draft-1" };

  it("preserves promotion but resets other route identity changes", () => {
    expect(
      shouldResetComposerQueueForRouteChange(draft, {
        routeKind: "server",
        routeThreadKey: draft.routeThreadKey,
        draftId: null,
      }),
    ).toBe(false);
    expect(shouldResetComposerQueueForRouteChange(draft, { ...draft, draftId: "draft-2" })).toBe(
      true,
    );
    expect(
      shouldResetComposerQueueForRouteChange(draft, {
        ...draft,
        routeThreadKey: "env:other-thread",
      }),
    ).toBe(true);
  });
});

describe("hasOptimisticWorkingSettled", () => {
  it("holds through session starting and title/branch session timestamp bumps", () => {
    const localDispatch = createLocalDispatchSnapshot(makeThread());

    expect(
      hasOptimisticWorkingSettled({
        localDispatch,
        latestTurn: null,
        session: {
          ...readySession,
          status: "starting",
          updatedAt: "2026-03-29T00:00:03.000Z",
        },
        threadError: null,
      }),
    ).toBe(false);
  });

  it("holds while the session is still the pre-dispatch ready snapshot", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );

    expect(
      hasOptimisticWorkingSettled({
        localDispatch,
        latestTurn: completedTurn,
        session: readySession,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("settles when the session is stopped, ready, or idle without a new turn", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );

    expect(
      hasOptimisticWorkingSettled({
        localDispatch,
        latestTurn: completedTurn,
        session: { ...readySession, status: "stopped", updatedAt: "2026-03-29T00:00:12.000Z" },
        threadError: null,
      }),
    ).toBe(true);
    expect(
      hasOptimisticWorkingSettled({
        localDispatch,
        latestTurn: completedTurn,
        session: { ...readySession, updatedAt: "2026-03-29T00:00:12.000Z" },
        threadError: null,
      }),
    ).toBe(true);
    expect(
      hasOptimisticWorkingSettled({
        localDispatch,
        latestTurn: completedTurn,
        session: { ...readySession, status: "idle", updatedAt: "2026-03-29T00:00:12.000Z" },
        threadError: null,
      }),
    ).toBe(true);
  });

  it("holds while the new turn is running", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );
    const runningTurn = {
      ...completedTurn,
      turnId: TurnId.make("turn-2"),
      state: "running" as const,
      requestedAt: "2026-03-29T00:01:00.000Z",
      startedAt: "2026-03-29T00:01:01.000Z",
      completedAt: null,
    };

    expect(
      hasOptimisticWorkingSettled({
        localDispatch,
        latestTurn: runningTurn,
        session: {
          ...readySession,
          status: "running",
          activeTurnId: runningTurn.turnId,
          updatedAt: runningTurn.startedAt,
        },
        threadError: null,
      }),
    ).toBe(false);
  });

  it("settles once the new turn completes and the session is no longer busy", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );
    const newerTurn = {
      ...completedTurn,
      turnId: TurnId.make("turn-2"),
      requestedAt: "2026-03-29T00:01:00.000Z",
      startedAt: "2026-03-29T00:01:01.000Z",
      completedAt: "2026-03-29T00:01:30.000Z",
    };

    expect(
      hasOptimisticWorkingSettled({
        localDispatch,
        latestTurn: newerTurn,
        session: { ...readySession, updatedAt: newerTurn.completedAt },
        threadError: null,
      }),
    ).toBe(true);
  });

  it("does not settle a completed turn while the session is still starting or running", () => {
    const localDispatch = createLocalDispatchSnapshot(makeThread());
    const runningTurn = {
      ...completedTurn,
      turnId: TurnId.make("turn-2"),
      state: "running" as const,
      requestedAt: "2026-03-29T00:01:00.000Z",
      startedAt: "2026-03-29T00:01:01.000Z",
      completedAt: "2026-03-29T00:01:02.000Z",
    };

    expect(
      hasOptimisticWorkingSettled({
        localDispatch,
        latestTurn: runningTurn,
        session: {
          ...readySession,
          status: "running",
          activeTurnId: runningTurn.turnId,
        },
        threadError: null,
      }),
    ).toBe(false);
  });

  it("settles on thread errors and session errors", () => {
    const localDispatch = createLocalDispatchSnapshot(makeThread());

    expect(
      hasOptimisticWorkingSettled({
        localDispatch,
        latestTurn: null,
        session: null,
        threadError: "Failed to send message.",
      }),
    ).toBe(true);
    expect(
      hasOptimisticWorkingSettled({
        localDispatch,
        latestTurn: null,
        session: { ...readySession, status: "error", lastError: "provider failed" },
        threadError: null,
      }),
    ).toBe(true);
  });
});

describe("composer runtime mode", () => {
  it("remaps carried Kimi yolo off Grok on a new draft", () => {
    expect(
      resolveComposerRuntimeMode({
        providerDriver: "grok",
        composerRuntimeMode: null,
        threadRuntimeMode: "yolo",
        isServerThread: false,
      }),
    ).toBe("full-access");
  });

  it("keeps yolo on Kimi", () => {
    expect(
      resolveComposerRuntimeMode({
        providerDriver: "kimi",
        composerRuntimeMode: null,
        threadRuntimeMode: "yolo",
        isServerThread: false,
      }),
    ).toBe("yolo");
  });

  it("lets an untouched draft inherit Kimi's yolo default", () => {
    expect(
      resolveComposerRuntimeMode({
        providerDriver: "kimi",
        composerRuntimeMode: null,
        threadRuntimeMode: "full-access",
        isServerThread: false,
      }),
    ).toBe("yolo");
  });

  it("keeps an explicit Full access pick on Kimi", () => {
    expect(
      resolveComposerRuntimeMode({
        providerDriver: "kimi",
        composerRuntimeMode: "full-access",
        threadRuntimeMode: "yolo",
        isServerThread: false,
      }),
    ).toBe("full-access");
  });

  it("treats the generic default as unset on drafts only", () => {
    expect(
      storedComposerRuntimeMode({
        composerRuntimeMode: null,
        threadRuntimeMode: "full-access",
        isServerThread: false,
      }),
    ).toBeNull();
    expect(
      storedComposerRuntimeMode({
        composerRuntimeMode: null,
        threadRuntimeMode: "full-access",
        isServerThread: true,
      }),
    ).toBe("full-access");
  });

  it("keeps a composer-recorded full-access carry instead of inheriting Kimi yolo", () => {
    expect(
      storedComposerRuntimeMode({
        composerRuntimeMode: "full-access",
        threadRuntimeMode: "full-access",
        isServerThread: false,
      }),
    ).toBe("full-access");
    expect(
      resolveComposerRuntimeMode({
        providerDriver: "kimi",
        composerRuntimeMode: "full-access",
        threadRuntimeMode: "full-access",
        isServerThread: false,
      }),
    ).toBe("full-access");
  });

  it("remaps carried yolo onto a known non-Kimi destination", () => {
    expect(
      resolveCarriedRuntimeMode({
        runtimeMode: "yolo",
        destinationProviderDriver: "grok",
      }),
    ).toBe("full-access");
    expect(
      resolveCarriedRuntimeMode({
        runtimeMode: "yolo",
        destinationProviderDriver: "kimi",
      }),
    ).toBe("yolo");
    expect(
      resolveCarriedRuntimeMode({
        runtimeMode: "yolo",
        destinationProviderDriver: null,
      }),
    ).toBe("yolo");
    expect(
      resolveCarriedRuntimeMode({
        runtimeMode: "yolo",
        destinationProviderDriver: "unconfigured",
      }),
    ).toBe("yolo");
    expect(
      resolveCarriedRuntimeMode({
        runtimeMode: null,
        destinationProviderDriver: "grok",
      }),
    ).toBeNull();
  });

  it("records only real picks as the carried composer runtime mode", () => {
    // Remapped yolo sticks as an explicit full-access pick.
    expect(
      resolveCarriedComposerRuntimeMode({
        runtimeMode: "yolo",
        destinationProviderDriver: "grok",
      }),
    ).toBe("full-access");
    // Non-default modes carry as explicit picks.
    expect(
      resolveCarriedComposerRuntimeMode({
        runtimeMode: "yolo",
        destinationProviderDriver: "kimi",
      }),
    ).toBe("yolo");
    // A plain carried full-access stays unset so Kimi inherits yolo.
    expect(
      resolveCarriedComposerRuntimeMode({
        runtimeMode: "full-access",
        destinationProviderDriver: "kimi",
      }),
    ).toBeNull();
    expect(
      resolveCarriedComposerRuntimeMode({
        runtimeMode: null,
        destinationProviderDriver: "grok",
      }),
    ).toBeNull();
  });
});
