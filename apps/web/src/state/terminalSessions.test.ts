import { describe, expect, it } from "@effect/vitest";

import type { TerminalSummary } from "@t3tools/contracts";

import { indexRunningTerminalIdsByThread } from "./terminalSessions";

const terminal = (overrides: Partial<TerminalSummary>): TerminalSummary => ({
  threadId: "thread-a",
  terminalId: "term-1",
  cwd: "/workspace",
  worktreePath: null,
  status: "running",
  pid: 1,
  exitCode: null,
  exitSignal: null,
  hasRunningSubprocess: true,
  label: "shell",
  updatedAt: "2026-08-23T00:00:00.000Z",
  ...overrides,
});

describe("indexRunningTerminalIdsByThread", () => {
  it("groups only active subprocess terminals and preserves numeric terminal order", () => {
    const index = indexRunningTerminalIdsByThread([
      terminal({ terminalId: "term-10" }),
      terminal({ terminalId: "term-2" }),
      terminal({ terminalId: "term-1", hasRunningSubprocess: false }),
      terminal({ threadId: "thread-b", terminalId: "term-3" }),
    ]);

    expect(index.get("thread-a")).toEqual(["term-2", "term-10"]);
    expect(index.get("thread-b")).toEqual(["term-3"]);
  });
});
