import { describe, expect, it } from "@effect/vitest";

import { shouldRefreshGitStatusAfterTurnComplete } from "./vcsStatus.ts";

describe("shouldRefreshGitStatusAfterTurnComplete", () => {
  it("does not refresh on first observation of a thread", () => {
    expect(
      shouldRefreshGitStatusAfterTurnComplete({
        previousThreadId: null,
        threadId: "thread-1",
        previousCompletedAt: null,
        completedAt: "2026-08-12T20:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("does not refresh when switching threads", () => {
    expect(
      shouldRefreshGitStatusAfterTurnComplete({
        previousThreadId: "thread-1",
        threadId: "thread-2",
        previousCompletedAt: "2026-08-12T20:00:00.000Z",
        completedAt: "2026-08-12T21:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("refreshes when the same thread's latest turn completes", () => {
    expect(
      shouldRefreshGitStatusAfterTurnComplete({
        previousThreadId: "thread-1",
        threadId: "thread-1",
        previousCompletedAt: null,
        completedAt: "2026-08-12T20:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("does not refresh when completedAt is unchanged", () => {
    expect(
      shouldRefreshGitStatusAfterTurnComplete({
        previousThreadId: "thread-1",
        threadId: "thread-1",
        previousCompletedAt: "2026-08-12T20:00:00.000Z",
        completedAt: "2026-08-12T20:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("refreshes when a follow-up turn completes", () => {
    expect(
      shouldRefreshGitStatusAfterTurnComplete({
        previousThreadId: "thread-1",
        threadId: "thread-1",
        previousCompletedAt: "2026-08-12T20:00:00.000Z",
        completedAt: "2026-08-12T20:04:00.000Z",
      }),
    ).toBe(true);
  });
});
