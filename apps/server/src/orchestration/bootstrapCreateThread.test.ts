import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isCompatibleBootstrapThread,
  shouldSkipBootstrapWorktreePrepare,
} from "./bootstrapCreateThread.ts";

const PROJECT_A = ProjectId.make("project-a");
const PROJECT_B = ProjectId.make("project-b");

const emptyThread = {
  id: ThreadId.make("thread-1"),
  projectId: PROJECT_A,
  worktreePath: null,
  latestTurn: null,
  session: null,
};

describe("isCompatibleBootstrapThread", () => {
  it("accepts an existing thread in the same project", () => {
    expect(
      isCompatibleBootstrapThread({
        existing: emptyThread,
        projectId: PROJECT_A,
      }),
    ).toBe(true);
  });

  it("rejects an existing thread in a different project", () => {
    expect(
      isCompatibleBootstrapThread({
        existing: emptyThread,
        projectId: PROJECT_B,
      }),
    ).toBe(false);
  });
});

describe("shouldSkipBootstrapWorktreePrepare", () => {
  it("still prepares a worktree for an unused draft thread", () => {
    expect(shouldSkipBootstrapWorktreePrepare(emptyThread)).toBe(false);
  });

  it("skips prepare when the thread already has a worktree", () => {
    expect(
      shouldSkipBootstrapWorktreePrepare({
        ...emptyThread,
        worktreePath: "/tmp/worktree",
      }),
    ).toBe(true);
  });

  it("skips prepare once a turn or session has started", () => {
    expect(
      shouldSkipBootstrapWorktreePrepare({
        ...emptyThread,
        latestTurn: {
          turnId: "turn-1" as never,
          state: "completed",
          requestedAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          assistantMessageId: null,
        },
      }),
    ).toBe(true);
    expect(
      shouldSkipBootstrapWorktreePrepare({
        ...emptyThread,
        session: {
          threadId: emptyThread.id,
          status: "ready",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ).toBe(true);
  });
});
