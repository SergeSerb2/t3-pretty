import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildLocalLiveActivityProps, liveActivityContentFingerprint } from "./localLiveActivity";

const environmentId = EnvironmentId.make("env-1");
const NOW = "2026-06-02T00:00:00.000Z";
const nowMs = Date.parse(NOW);

function makeThread(
  input: Partial<EnvironmentThreadShell> & Pick<EnvironmentThreadShell, "id" | "title">,
): EnvironmentThreadShell {
  return {
    environmentId,
    projectId: ProjectId.make("project-1"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...input,
  };
}

const projects = [
  {
    id: ProjectId.make("project-1"),
    environmentId,
    title: "t3-pretty",
  },
];

describe("buildLocalLiveActivityProps", () => {
  it("returns null when nothing is in flight or recently finished", () => {
    expect(
      buildLocalLiveActivityProps({
        threads: [makeThread({ id: ThreadId.make("idle"), title: "Idle" })],
        projects,
        nowMs,
      }),
    ).toBeNull();
  });

  it("does not arm a Done card from a ready session with no completed turn", () => {
    expect(
      buildLocalLiveActivityProps({
        threads: [
          makeThread({
            id: ThreadId.make("ready"),
            title: "Recently opened",
            session: {
              threadId: ThreadId.make("ready"),
              status: "ready",
              providerName: "Codex",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: NOW,
            },
          }),
        ],
        projects,
        nowMs,
      }),
    ).toBeNull();
  });

  it("builds a live card from connected thread shells, including plan progress", () => {
    const props = buildLocalLiveActivityProps({
      threads: [
        makeThread({
          id: ThreadId.make("thread-1"),
          title: "Fix Live Activities",
          planProgress: {
            step: "Editing AgentActivity.tsx",
            completedSteps: 2,
            totalSteps: 5,
          },
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "running",
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: TurnId.make("turn-1"),
            lastError: null,
            updatedAt: NOW,
          },
        }),
      ],
      projects,
      nowMs,
    });

    expect(props).toMatchObject({
      title: "T3 Pretty",
      subtitle: "Agent work in progress",
      activeCount: 1,
      activities: [
        {
          threadTitle: "Fix Live Activities",
          projectTitle: "t3-pretty",
          phase: "running",
          status: "Editing AgentActivity.tsx",
          progress: 0.4,
        },
      ],
    });
  });

  it("keeps recently finished work as Done instead of dropping the card", () => {
    const props = buildLocalLiveActivityProps({
      threads: [
        makeThread({
          id: ThreadId.make("thread-1"),
          title: "Done thread",
          latestTurn: {
            turnId: TurnId.make("turn-1"),
            state: "completed",
            requestedAt: NOW,
            startedAt: NOW,
            completedAt: NOW,
            assistantMessageId: null,
          },
        }),
      ],
      projects,
      nowMs,
    });

    expect(props).toMatchObject({
      activeCount: 0,
      subtitle: "Agent work completed",
      activities: [{ phase: "completed", status: "Done" }],
    });
  });

  it("ignores finished threads once the display window elapses", () => {
    expect(
      buildLocalLiveActivityProps({
        threads: [
          makeThread({
            id: ThreadId.make("thread-1"),
            title: "Old done",
            updatedAt: "2026-06-01T23:40:00.000Z",
            latestTurn: {
              turnId: TurnId.make("turn-1"),
              state: "completed",
              requestedAt: "2026-06-01T23:40:00.000Z",
              startedAt: "2026-06-01T23:40:00.000Z",
              completedAt: "2026-06-01T23:40:00.000Z",
              assistantMessageId: null,
            },
          }),
        ],
        projects,
        nowMs,
      }),
    ).toBeNull();
  });
});

describe("liveActivityContentFingerprint", () => {
  it("ignores updatedAt so relative clocks can tick without a native rewrite", () => {
    const first = liveActivityContentFingerprint({
      title: "T3 Pretty",
      subtitle: "Agent work in progress",
      activeCount: 1,
      updatedAt: "2026-06-02T00:00:00.000Z",
      activities: [
        {
          environmentId: "env-1",
          threadId: "thread-1",
          projectTitle: "t3-pretty",
          threadTitle: "Fix Live Activities",
          modelTitle: "gpt-5.4",
          phase: "running",
          status: "Working",
          updatedAt: "2026-06-02T00:00:00.000Z",
          deepLink: "/threads/env-1/thread-1",
        },
      ],
    });
    const second = liveActivityContentFingerprint({
      title: "T3 Pretty",
      subtitle: "Agent work in progress",
      activeCount: 1,
      updatedAt: "2026-06-02T00:01:00.000Z",
      activities: [
        {
          environmentId: "env-1",
          threadId: "thread-1",
          projectTitle: "t3-pretty",
          threadTitle: "Fix Live Activities",
          modelTitle: "gpt-5.4",
          phase: "running",
          status: "Working",
          updatedAt: "2026-06-02T00:01:00.000Z",
          deepLink: "/threads/env-1/thread-1",
        },
      ],
    });
    expect(first).toBe(second);
  });
});
