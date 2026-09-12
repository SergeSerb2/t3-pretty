import { describe, expect, it } from "vite-plus/test";

import { parseAutomationDetailRoute } from "./automationNavigation";
import {
  automationCommandErrorMessage,
  automationNextRunLabel,
  automationRunStatusTone,
  automationStatusTone,
  collapsedRunsLabel,
  formatRunDuration,
  resolveAutomationEnvironmentId,
} from "./automations.logic";

describe("automationStatusTone", () => {
  it("stays silent for a healthy idle automation", () => {
    expect(automationStatusTone("idle")).toBeNull();
  });

  it("labels the states a row must call out", () => {
    expect(automationStatusTone("running")?.label).toBe("Running");
    expect(automationStatusTone("needs-attention")?.label).toBe("Needs you");
    expect(automationStatusTone("failed")?.label).toBe("Failed");
    expect(automationStatusTone("paused")?.label).toBe("Paused");
  });
});

describe("automationNextRunLabel", () => {
  const nowMs = Date.parse("2026-09-06T12:00:00.000Z");

  it("counts down to the next scheduled instant", () => {
    expect(
      automationNextRunLabel({ enabled: true, nextRunAt: "2026-09-06T12:30:00.000Z" }, nowMs),
    ).toBe("in 30m");
  });

  it("says nothing while paused or unscheduled", () => {
    expect(
      automationNextRunLabel({ enabled: false, nextRunAt: "2026-09-06T12:30:00.000Z" }, nowMs),
    ).toBeNull();
    expect(automationNextRunLabel({ enabled: true, nextRunAt: null }, nowMs)).toBeNull();
  });
});

describe("collapsedRunsLabel", () => {
  it("counts the runs and names the uneventful ones", () => {
    expect(collapsedRunsLabel({ count: 6, skipped: 2, missed: 1 })).toBe(
      "6 more runs · 2 skipped · 1 missed",
    );
    expect(collapsedRunsLabel({ count: 4, skipped: 0, missed: 0 })).toBe("4 more runs");
    expect(collapsedRunsLabel({ count: 1, skipped: 0, missed: 0 })).toBe("1 more run");
  });
});

describe("formatRunDuration", () => {
  it("measures a finished run", () => {
    expect(formatRunDuration("2026-09-06T12:00:00Z", "2026-09-06T12:00:42Z", 0)).toBe("42s");
    expect(formatRunDuration("2026-09-06T12:00:00Z", "2026-09-06T12:03:04Z", 0)).toBe("3m 4s");
    expect(formatRunDuration("2026-09-06T12:00:00Z", "2026-09-06T13:02:00Z", 0)).toBe("1h 2m");
  });

  it("measures a running one against now, and nothing before it starts", () => {
    expect(
      formatRunDuration("2026-09-06T12:00:00Z", null, Date.parse("2026-09-06T12:00:10Z")),
    ).toBe("10s");
    expect(formatRunDuration(null, null, 0)).toBeNull();
  });
});

describe("automationCommandErrorMessage", () => {
  it("unwraps a decider rejection to its plain sentence", () => {
    expect(
      automationCommandErrorMessage(
        new Error(
          "Orchestration command invariant failed (automation.run.request): A run is already in progress.",
        ),
        "fallback",
      ),
    ).toBe("A run is already in progress.");
  });

  it("falls back when the failure carries no message", () => {
    expect(automationCommandErrorMessage({ nope: true }, "fallback")).toBe("fallback");
    expect(automationCommandErrorMessage(new Error("   "), "fallback")).toBe("fallback");
  });
});

describe("resolveAutomationEnvironmentId", () => {
  const environments = [{ environmentId: "a" }, { environmentId: "b" }];

  it("keeps a selection that still exists", () => {
    expect(resolveAutomationEnvironmentId("b", "a", environments)).toBe("b");
  });

  it("falls back when the selected environment is gone", () => {
    expect(resolveAutomationEnvironmentId("gone", "a", environments)).toBe("a");
    expect(resolveAutomationEnvironmentId(null, "a", environments)).toBe("a");
    expect(resolveAutomationEnvironmentId("b", "a", [])).toBe("a");
  });
});

describe("automationRunStatusTone", () => {
  it("names every run status", () => {
    expect(automationRunStatusTone("completed").label).toBe("Completed");
    expect(automationRunStatusTone("failed").label).toBe("Failed");
    expect(automationRunStatusTone("interrupted").label).toBe("Interrupted");
    expect(automationRunStatusTone("skipped").label).toBe("Skipped");
    expect(automationRunStatusTone("missed").label).toBe("Missed");
    expect(automationRunStatusTone("requested").label).toBe("Queued");
    expect(automationRunStatusTone("running").label).toBe("Running");
  });
});

describe("parseAutomationDetailRoute", () => {
  it("accepts a well-formed link", () => {
    expect(parseAutomationDetailRoute({ environmentId: " env ", automationId: "auto" })).toEqual({
      environmentId: "env",
      automationId: "auto",
    });
  });

  it("rejects empty and oversized ids from a deep link", () => {
    expect(parseAutomationDetailRoute({ environmentId: "", automationId: "auto" })).toBeNull();
    expect(parseAutomationDetailRoute({ environmentId: "env", automationId: "   " })).toBeNull();
    expect(
      parseAutomationDetailRoute({ environmentId: "env", automationId: "a".repeat(5_000) }),
    ).toBeNull();
  });
});
