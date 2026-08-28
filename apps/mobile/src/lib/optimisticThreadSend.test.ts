import { describe, expect, it } from "vite-plus/test";

import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationMessage,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import type { QueuedThreadMessage } from "../state/thread-outbox-model";
import {
  isOptimisticStartingThreadPending,
  mergeOptimisticThreadMessages,
  mergePresentedThreadShells,
  optimisticStartingThreadToShell,
  queuedThreadMessageToFeedMessage,
  resolveOptimisticSendStartedAt,
  type OptimisticStartingThread,
} from "./optimisticThreadSend";

const environmentId = EnvironmentId.make("environment-1");
const threadId = ThreadId.make("thread-1");
const projectId = ProjectId.make("project-1");

function startingThread(
  overrides: Partial<OptimisticStartingThread> = {},
): OptimisticStartingThread {
  return {
    environmentId,
    threadId,
    projectId,
    title: "Build the composer",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    sendStartedAt: "2026-04-01T00:00:00.500Z",
    message: {
      messageId: MessageId.make("message-1"),
      text: "Build the composer",
      createdAt: "2026-04-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function queuedMessage(overrides: Partial<QueuedThreadMessage> = {}): QueuedThreadMessage {
  return {
    environmentId,
    threadId,
    messageId: MessageId.make("queued-1"),
    commandId: CommandId.make("command-1"),
    text: "Follow up",
    attachments: [],
    createdAt: "2026-04-01T00:00:02.000Z",
    ...overrides,
  };
}

function serverMessage(
  overrides: Partial<OrchestrationMessage> & Pick<OrchestrationMessage, "id">,
): OrchestrationMessage {
  return {
    role: "user",
    text: "Build the composer",
    turnId: null,
    streaming: false,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function serverShell(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    environmentId,
    id: threadId,
    projectId,
    title: "Server thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    enabledSkillIds: [],
    branch: "main",
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("optimisticStartingThreadToShell", () => {
  it("presents a starting session so the thread looks live while create is in flight", () => {
    const shell = optimisticStartingThreadToShell(startingThread());

    expect(shell).toMatchObject({
      environmentId,
      id: threadId,
      title: "Build the composer",
      session: { status: "starting", activeTurnId: null },
      latestUserMessageAt: "2026-04-01T00:00:00.000Z",
    });
  });
});

describe("isOptimisticStartingThreadPending", () => {
  it("settles only failed native resume starts", () => {
    const resume = startingThread({
      message: { ...startingThread().message, text: "/resume native-session" },
    });

    expect(isOptimisticStartingThreadPending(resume, "starting")).toBe(true);
    expect(isOptimisticStartingThreadPending(resume, "error")).toBe(false);
    expect(isOptimisticStartingThreadPending(startingThread(), "error")).toBe(true);
    expect(isOptimisticStartingThreadPending(null, "error")).toBe(false);
  });
});

describe("mergeOptimisticThreadMessages", () => {
  it("shows the starting prompt when the server thread has no detail yet", () => {
    const merged = mergeOptimisticThreadMessages(null, [], startingThread());

    expect(merged).toEqual([
      expect.objectContaining({
        id: MessageId.make("message-1"),
        role: "user",
        text: "Build the composer",
      }),
    ]);
  });

  it("keeps queued follow-ups that the server has not projected", () => {
    const merged = mergeOptimisticThreadMessages(
      [serverMessage({ id: MessageId.make("message-1") })],
      [queuedMessage()],
      null,
    );

    expect(merged.map((message) => String(message.id))).toEqual(["message-1", "queued-1"]);
  });

  it("drops a local copy once the server has the same message id", () => {
    const merged = mergeOptimisticThreadMessages(
      [serverMessage({ id: MessageId.make("message-1"), text: "Build the composer" })],
      [],
      startingThread(),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("Build the composer");
  });
});

describe("queuedThreadMessageToFeedMessage", () => {
  it("renders as a settled user row", () => {
    expect(queuedThreadMessageToFeedMessage(queuedMessage())).toMatchObject({
      id: MessageId.make("queued-1"),
      role: "user",
      text: "Follow up",
      streaming: false,
      turnId: null,
    });
  });
});

describe("resolveOptimisticSendStartedAt", () => {
  const idle = {
    latestTurnStartedAt: null,
    latestTurnCompletedAt: null,
    sessionStatus: null,
    sessionUpdatedAt: null,
    optimisticSendStartedAt: null,
    queuedHeadCreatedAt: null,
    isDeliveringQueuedMessage: false,
    environmentConnected: true,
  };

  it("uses the starting-thread clock before the session exists", () => {
    expect(
      resolveOptimisticSendStartedAt({
        ...idle,
        optimisticSendStartedAt: "2026-04-01T00:00:00.500Z",
      }),
    ).toBe("2026-04-01T00:00:00.500Z");
  });

  it("uses the queued send clock while the outbox is delivering", () => {
    expect(
      resolveOptimisticSendStartedAt({
        ...idle,
        queuedHeadCreatedAt: "2026-04-01T00:00:02.000Z",
        isDeliveringQueuedMessage: true,
      }),
    ).toBe("2026-04-01T00:00:02.000Z");
  });

  it("keeps thinking while the provider session is only starting", () => {
    expect(
      resolveOptimisticSendStartedAt({
        ...idle,
        sessionStatus: "starting",
        sessionUpdatedAt: "2026-04-01T00:00:03.000Z",
      }),
    ).toBe("2026-04-01T00:00:03.000Z");
  });

  it("hands the working row to a real started turn", () => {
    expect(
      resolveOptimisticSendStartedAt({
        ...idle,
        latestTurnStartedAt: "2026-04-01T00:00:04.000Z",
        latestTurnCompletedAt: null,
        sessionStatus: "running",
        optimisticSendStartedAt: "2026-04-01T00:00:00.500Z",
      }),
    ).toBeNull();
  });

  it("clears after the turn settles so thinking cannot stick", () => {
    expect(
      resolveOptimisticSendStartedAt({
        ...idle,
        latestTurnStartedAt: "2026-04-01T00:00:04.000Z",
        latestTurnCompletedAt: "2026-04-01T00:00:10.000Z",
        sessionStatus: "ready",
        optimisticSendStartedAt: null,
        queuedHeadCreatedAt: null,
      }),
    ).toBeNull();
  });
});

describe("mergePresentedThreadShells", () => {
  it("inserts a starting thread the server has not listed yet", () => {
    const presented = mergePresentedThreadShells(
      [serverShell({ id: ThreadId.make("thread-2"), title: "Older" })],
      [startingThread()],
    );

    expect(presented.map((thread) => String(thread.id))).toEqual(["thread-1", "thread-2"]);
  });

  it("does not duplicate a thread the shell already has", () => {
    const presented = mergePresentedThreadShells([serverShell()], [startingThread()]);

    expect(presented).toHaveLength(1);
    expect(presented[0]?.title).toBe("Server thread");
  });
});
