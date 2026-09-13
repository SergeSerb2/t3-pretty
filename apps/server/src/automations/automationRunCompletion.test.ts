import type { OrchestrationLatestTurn, OrchestrationSession } from "@t3tools/contracts";
import { ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveAutomationRunCompletion } from "./automationRunCompletion.ts";

const turn = (state: OrchestrationLatestTurn["state"]): OrchestrationLatestTurn => ({
  turnId: TurnId.make("turn-1"),
  state,
  requestedAt: "2026-09-06T09:00:00.000Z",
  startedAt: "2026-09-06T09:00:01.000Z",
  completedAt: state === "running" ? null : "2026-09-06T09:05:00.000Z",
  assistantMessageId: null,
});

const session = (
  status: OrchestrationSession["status"],
  lastError: string | null = null,
): OrchestrationSession => ({
  threadId: ThreadId.make("thread-1"),
  status,
  providerName: "codex",
  runtimeMode: "full-access",
  activeTurnId: null,
  lastError,
  updatedAt: "2026-09-06T09:05:00.000Z",
});

describe("resolveAutomationRunCompletion", () => {
  it("maps a completed turn to completed", () => {
    expect(
      resolveAutomationRunCompletion({ latestTurn: turn("completed"), session: session("ready") }),
    ).toEqual({ status: "completed", error: null });
  });

  it("maps an errored turn to failed with the session error", () => {
    expect(
      resolveAutomationRunCompletion({
        latestTurn: turn("error"),
        session: session("error", "Provider crashed"),
      }),
    ).toEqual({ status: "failed", error: "Provider crashed" });
    expect(resolveAutomationRunCompletion({ latestTurn: turn("error"), session: null })).toEqual({
      status: "failed",
      error: "Turn failed",
    });
  });

  it("maps an interrupted turn to interrupted", () => {
    expect(
      resolveAutomationRunCompletion({
        latestTurn: turn("interrupted"),
        session: session("interrupted"),
      }),
    ).toEqual({ status: "interrupted", error: null });
  });

  it("fails a run whose session errored before any turn", () => {
    expect(
      resolveAutomationRunCompletion({ latestTurn: null, session: session("error", "No auth") }),
    ).toEqual({ status: "failed", error: "No auth" });
  });

  it("stays open while the turn runs or nothing has happened yet", () => {
    expect(
      resolveAutomationRunCompletion({ latestTurn: turn("running"), session: session("running") }),
    ).toBeNull();
    expect(resolveAutomationRunCompletion({ latestTurn: null, session: null })).toBeNull();
    expect(
      resolveAutomationRunCompletion({ latestTurn: null, session: session("ready") }),
    ).toBeNull();
  });
});
