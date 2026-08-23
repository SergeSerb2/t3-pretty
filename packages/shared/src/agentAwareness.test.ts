import { describe, expect, it } from "@effect/vitest";

import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { ProviderInstanceId } from "@t3tools/contracts";

import { projectThreadAwareness } from "./agentAwareness.ts";

const NOW = "2026-05-22T12:00:00.000Z";

const project = {
  title: "t3code",
} satisfies Pick<OrchestrationProjectShell, "title">;

function thread(
  overrides: Partial<OrchestrationThreadShell> = {},
): Pick<
  OrchestrationThreadShell,
  | "id"
  | "title"
  | "modelSelection"
  | "session"
  | "latestTurn"
  | "updatedAt"
  | "latestUserMessageAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "backgroundLiveness"
  | "planProgress"
> {
  return {
    id: "thread-1" as ThreadId,
    title: "Fix failing CI",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    session: null,
    latestTurn: null,
    updatedAt: NOW,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...overrides,
  };
}

describe("projectThreadAwareness", () => {
  it("returns null for idle threads without an active awareness state", () => {
    expect(
      projectThreadAwareness({
        environmentId: "env-1" as EnvironmentId,
        project,
        thread: thread(),
      }),
    ).toBeNull();
  });

  it("prioritizes approval requests over running state", () => {
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        hasPendingApprovals: true,
        session: {
          threadId: "thread-1" as ThreadId,
          status: "running",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: "turn-1" as TurnId,
          lastError: null,
          updatedAt: NOW,
        },
      }),
    });

    expect(state?.phase).toBe("waiting_for_approval");
    expect(state?.headline).toBe("Approval needed");
  });

  it("projects running provider sessions", () => {
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        session: {
          threadId: "thread-1" as ThreadId,
          status: "running",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: "turn-1" as TurnId,
          lastError: null,
          updatedAt: NOW,
        },
      }),
    });

    expect(state).toMatchObject({
      phase: "running",
      headline: "Agent is working",
      modelTitle: "gpt-5.4",
      deepLink: "/threads/env-1/thread-1",
    });
    expect(state?.detail).toBeUndefined();
  });

  it("carries the running turn's start time so the card can tick an elapsed timer", () => {
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        latestTurn: {
          turnId: "turn-1" as TurnId,
          state: "running",
          requestedAt: "2026-05-22T11:58:00.000Z",
          startedAt: "2026-05-22T11:59:00.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    });

    expect(state?.phase).toBe("running");
    expect(state?.startedAt).toBe("2026-05-22T11:59:00.000Z");
  });

  it("omits the start time for waiting phases and sessions without a running turn", () => {
    const waiting = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({ hasPendingApprovals: true }),
    });
    expect(waiting?.startedAt).toBeUndefined();

    const sessionOnly = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        session: {
          threadId: "thread-1" as ThreadId,
          status: "running",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: "turn-1" as TurnId,
          lastError: null,
          updatedAt: NOW,
        },
      }),
    });
    expect(sessionOnly?.phase).toBe("running");
    expect(sessionOnly?.startedAt).toBeUndefined();
  });

  it("pins the starting timer to the prompt stamp, not later session.updatedAt", () => {
    const promptAt = "2026-05-22T11:59:30.000Z";
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        updatedAt: NOW,
        latestUserMessageAt: promptAt,
        session: {
          threadId: "thread-1" as ThreadId,
          status: "starting",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
      }),
    });

    expect(state?.phase).toBe("starting");
    expect(state?.startedAt).toBe(promptAt);
  });

  it("does not pin a starting session's timer to a settled prior turn", () => {
    const promptAt = "2026-05-22T11:50:00.000Z";
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        updatedAt: NOW,
        latestUserMessageAt: promptAt,
        latestTurn: {
          turnId: "turn-1" as TurnId,
          state: "completed",
          requestedAt: "2026-05-22T11:00:00.000Z",
          startedAt: "2026-05-22T11:00:01.000Z",
          completedAt: "2026-05-22T11:02:00.000Z",
          assistantMessageId: null,
        },
        session: {
          threadId: "thread-1" as ThreadId,
          status: "starting",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
      }),
    });

    expect(state?.phase).toBe("starting");
    expect(state?.startedAt).toBe(promptAt);
  });

  it("falls back to the session stamp when starting has no newer prompt", () => {
    const sessionStartedAt = "2026-05-22T11:50:00.000Z";
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        updatedAt: NOW,
        latestUserMessageAt: "2026-05-22T11:00:00.000Z",
        latestTurn: {
          turnId: "turn-1" as TurnId,
          state: "completed",
          requestedAt: "2026-05-22T11:00:00.000Z",
          startedAt: "2026-05-22T11:00:01.000Z",
          completedAt: "2026-05-22T11:02:00.000Z",
          assistantMessageId: null,
        },
        session: {
          threadId: "thread-1" as ThreadId,
          status: "starting",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: sessionStartedAt,
        },
      }),
    });

    expect(state?.phase).toBe("starting");
    expect(state?.startedAt).toBe(sessionStartedAt);
  });

  it("surfaces the current plan step as the running detail", () => {
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        planProgress: {
          step: "Editing AgentActivity.tsx",
          completedSteps: 2,
          totalSteps: 5,
        },
        session: {
          threadId: "thread-1" as ThreadId,
          status: "running",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: "turn-1" as TurnId,
          lastError: null,
          updatedAt: NOW,
        },
      }),
    });

    expect(state?.phase).toBe("running");
    expect(state?.detail).toBe("Editing AgentActivity.tsx");
    expect(state?.progress).toBe(0.4);
  });

  it("keeps background fleets running after the parent session settles", () => {
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        backgroundLiveness: "working",
        session: {
          threadId: "thread-1" as ThreadId,
          status: "ready",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
      }),
    });

    expect(state?.phase).toBe("running");
  });

  it("projects completed turns as completed even when teardown settled them as interrupted", () => {
    const finishedTurn = {
      turnId: "turn-1" as TurnId,
      state: "interrupted" as const,
      requestedAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
      assistantMessageId: null,
    };
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({ latestTurn: finishedTurn }),
    });

    // Session teardown settles still-running turns by session status, and
    // that write can race turn.completed; the completion timestamp is the
    // durable signal. Without this the thread resolves to null persistently
    // and gets tombstoned off the lock-screen card instead of showing Done.
    expect(state?.phase).toBe("completed");

    const trulyInterrupted = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({ latestTurn: { ...finishedTurn, completedAt: null } }),
    });
    expect(trulyInterrupted).toBeNull();
  });

  it("projects ready sessions with no materialized turn as completed", () => {
    // Quick threads without code changes never get a checkpoint, so the SQL
    // shell has no latestTurn row and latest_turn_id is cleared when the
    // session settles; the ready session is the only completion signal left.
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        session: {
          threadId: "thread-1" as ThreadId,
          status: "ready",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
      }),
    });

    expect(state?.phase).toBe("completed");
  });

  it("projects failures with the session error detail", () => {
    const state = projectThreadAwareness({
      environmentId: "env-1" as EnvironmentId,
      project,
      thread: thread({
        session: {
          threadId: "thread-1" as ThreadId,
          status: "error",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: "Provider process exited.",
          updatedAt: NOW,
        },
      }),
    });

    expect(state).toMatchObject({
      phase: "failed",
      headline: "Agent failed",
      detail: "Provider process exited.",
    });
  });
});
