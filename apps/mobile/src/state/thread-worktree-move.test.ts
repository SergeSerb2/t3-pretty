import { describe, expect, it } from "vite-plus/test";

import { shouldStopSessionOnWorktreeMove } from "./thread-worktree-move";

describe("shouldStopSessionOnWorktreeMove", () => {
  it("does not stop when the current worktree path is unknown", () => {
    expect(
      shouldStopSessionOnWorktreeMove({
        sessionStatus: "running",
        currentWorktreePath: null,
        nextWorktreePath: "/repo/.t3/worktrees/feature",
      }),
    ).toBe(false);
  });

  it("does not stop when the worktree path did not change", () => {
    expect(
      shouldStopSessionOnWorktreeMove({
        sessionStatus: "running",
        currentWorktreePath: "/repo/.t3/worktrees/feature",
        nextWorktreePath: "/repo/.t3/worktrees/feature",
      }),
    ).toBe(false);
  });

  it("stops a live session when both paths are known and differ", () => {
    expect(
      shouldStopSessionOnWorktreeMove({
        sessionStatus: "running",
        currentWorktreePath: "/repo",
        nextWorktreePath: "/repo/.t3/worktrees/feature",
      }),
    ).toBe(true);
    expect(
      shouldStopSessionOnWorktreeMove({
        sessionStatus: "starting",
        currentWorktreePath: "/repo/.t3/worktrees/old",
        nextWorktreePath: "/repo/.t3/worktrees/new",
      }),
    ).toBe(true);
  });

  it("does not stop a stopped or missing session", () => {
    expect(
      shouldStopSessionOnWorktreeMove({
        sessionStatus: "stopped",
        currentWorktreePath: "/repo",
        nextWorktreePath: "/repo/.t3/worktrees/feature",
      }),
    ).toBe(false);
    expect(
      shouldStopSessionOnWorktreeMove({
        sessionStatus: undefined,
        currentWorktreePath: "/repo",
        nextWorktreePath: "/repo/.t3/worktrees/feature",
      }),
    ).toBe(false);
  });
});
