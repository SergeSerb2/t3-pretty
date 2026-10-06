import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { summarizeHomeGlance } from "./home-glance";

const NOW = "2026-10-04T12:00:00.000Z";
let nextId = 0;

function thread(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  nextId += 1;
  return makeThreadShellFixture({ id: ThreadId.make(`glance-${nextId}`), ...overrides });
}

function runtime(
  status: NonNullable<EnvironmentThreadShell["runtime"]>["status"],
  lastErrorClass: NonNullable<EnvironmentThreadShell["runtime"]>["lastErrorClass"] = null,
): EnvironmentThreadShell["runtime"] {
  return {
    status,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: status === "failed" ? "boom" : null,
    lastErrorClass,
    updatedAt: NOW,
  };
}

const approval = () => thread({ hasPendingApprovals: true });
const input = () => thread({ hasPendingUserInput: true });
const working = () => thread({ runtime: runtime("running") });
const failed = () => thread({ runtime: runtime("failed") });
const limited = () => thread({ runtime: runtime("failed", "usage_limit") });
const unread = () =>
  thread({
    lastVisitedAt: "2026-10-04T11:00:00.000Z",
    latestRun: {
      runId: RunId.make(`run-${nextId}`),
      status: "completed",
      requestedAt: "2026-10-04T11:10:00.000Z",
      startedAt: "2026-10-04T11:10:00.000Z",
      completedAt: "2026-10-04T11:30:00.000Z",
      assistantMessageId: null,
    },
  });

describe("summarizeHomeGlance", () => {
  it("is caught up when no card carries a status label", () => {
    expect(summarizeHomeGlance([])).toEqual({
      headline: "All caught up",
      detail: null,
      tone: null,
    });
    // Ready and waiting cards show a time, not a label.
    expect(summarizeHomeGlance([thread(), thread({ runtime: runtime("idle") })])).toEqual({
      headline: "All caught up",
      detail: null,
      tone: null,
    });
  });

  it("counts approval and input requests together as needing the user", () => {
    expect(summarizeHomeGlance([approval()]).headline).toBe("1 thread needs you");
    expect(summarizeHomeGlance([approval(), input()]).headline).toBe("2 threads need you");
  });

  it("takes its tone from the most urgent badge present in the lead group", () => {
    expect(summarizeHomeGlance([input()]).tone).toBe("input");
    expect(summarizeHomeGlance([input(), approval()]).tone).toBe("approval");
    expect(summarizeHomeGlance([working(), unread()]).tone).toBe("working");
  });

  it("leads with the most urgent state and lists the rest in attention order", () => {
    expect(
      summarizeHomeGlance([unread(), working(), working(), limited(), failed(), input()]),
    ).toEqual({
      headline: "1 thread needs you",
      detail: "1 failed · 1 limited · 2 working · 1 done",
      tone: "input",
    });
    expect(summarizeHomeGlance([unread(), working(), working(), working()])).toEqual({
      headline: "3 threads working",
      detail: "1 done",
      tone: "working",
    });
  });

  it("counts an unopened completion as done", () => {
    expect(summarizeHomeGlance([unread(), unread()])).toEqual({
      headline: "2 threads done",
      detail: null,
      tone: "done",
    });
  });
});
