import { describe, expect, it } from "vite-plus/test";

import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  activitySeedsHeadline,
  headlineActivityId,
  headlineJobForActivity,
  HEADLINE_ACTIVITY_KIND,
} from "./ActivityHeadlineReactor.ts";

function makeActivity(overrides: {
  kind?: string;
  tone?: OrchestrationThreadActivity["tone"];
  summary?: string;
  payload?: unknown;
  turnId?: string | null;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make("activity-1"),
    createdAt: "2026-08-22T00:00:00.000Z",
    kind: overrides.kind ?? "tool.started",
    summary: overrides.summary ?? "Running command",
    tone: overrides.tone ?? "tool",
    payload: overrides.payload ?? {},
    turnId: overrides.turnId === null ? null : TurnId.make(overrides.turnId ?? "turn-1"),
  };
}

describe("activitySeedsHeadline", () => {
  it("seeds on tool lifecycle and error activities with a turn", () => {
    expect(activitySeedsHeadline(makeActivity({ kind: "tool.started" }))).toBe(true);
    expect(activitySeedsHeadline(makeActivity({ kind: "tool.updated" }))).toBe(true);
    expect(activitySeedsHeadline(makeActivity({ kind: "provider.error", tone: "error" }))).toBe(
      true,
    );
  });

  it("never seeds on its own output, turnless rows, or unrelated kinds", () => {
    expect(activitySeedsHeadline(makeActivity({ kind: HEADLINE_ACTIVITY_KIND }))).toBe(false);
    expect(activitySeedsHeadline(makeActivity({ kind: "tool.started", turnId: null }))).toBe(false);
    expect(activitySeedsHeadline(makeActivity({ kind: "context-window.updated" }))).toBe(false);
  });
});

describe("headlineJobForActivity", () => {
  it("extracts summary, command, and detail for the generator", () => {
    const job = headlineJobForActivity(
      makeActivity({
        kind: "tool.updated",
        summary: "Shell",
        payload: { command: "rg -n foo src", detail: "12 matches" },
        turnId: "turn-9",
      }),
    );
    expect(job).toEqual({
      turnId: TurnId.make("turn-9"),
      summary: "Shell",
      command: "rg -n foo src",
      detail: "12 matches",
    });
  });

  it("returns null for non-seeding activities", () => {
    expect(headlineJobForActivity(makeActivity({ kind: HEADLINE_ACTIVITY_KIND }))).toBeNull();
  });
});

describe("headlineActivityId", () => {
  it("is stable per turn so each generation replaces the previous row", () => {
    const turnId = TurnId.make("turn-3");
    expect(headlineActivityId(turnId)).toBe(headlineActivityId(turnId));
    expect(headlineActivityId(turnId)).toBe(EventId.make("turn-3:headline"));
  });
});
