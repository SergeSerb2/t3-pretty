// @effect-diagnostics globalDate:off -- Fixed instants keep the calendar-grouping assertions deterministic.
import { describe, expect, it } from "vite-plus/test";
import {
  AutomationId,
  AutomationRunId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationShell,
} from "@t3tools/contracts";

import {
  automationNeedsAttention,
  automationStatus,
  condenseAutomationRunGroup,
  formatUntilLabel,
  groupAutomationRunsByDay,
  isAutomationRunThread,
} from "./automations.ts";

const AUTOMATION_ID = AutomationId.make("automation-1");
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");

const AUTOMATION: AutomationShell = {
  id: AUTOMATION_ID,
  projectId: PROJECT_ID,
  name: "Nightly triage",
  prompt: "Triage the inbox",
  triggers: [{ type: "schedule", cron: "0 9 * * *", timezone: "UTC" }],
  enabled: true,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  workspace: "checkout",
  createPullRequest: false,
  includeLastRunSummary: false,
  catchUpMissedRuns: true,
  minIntervalSeconds: 60,
  timeoutMinutes: 120,
  webhookToken: null,
  sourceThreadId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  nextRunAt: "2026-09-07T09:00:00.000Z",
  activeRun: null,
  lastRun: null,
  lastRequestedAt: null,
  pendingTrigger: null,
  consecutiveFailures: 0,
  runCount: 0,
  webhookPath: null,
};

const run = (id: string, status: AutomationRunStatus, requestedAt: string): AutomationRun => ({
  id: AutomationRunId.make(id),
  automationId: AUTOMATION_ID,
  projectId: PROJECT_ID,
  threadId: null,
  status,
  trigger: { type: "manual", byThreadId: null },
  requestedAt,
  startedAt: null,
  finishedAt: null,
  error: null,
  summary: null,
});

const automationMap = (...automations: ReadonlyArray<AutomationShell>) =>
  new Map(automations.map((automation) => [automation.id, automation]));

describe("isAutomationRunThread", () => {
  it("hides a run thread whose automation the client knows", () => {
    expect(
      isAutomationRunThread(
        { automationRun: { automationId: AUTOMATION_ID, runId: AutomationRunId.make("run-1") } },
        automationMap(AUTOMATION),
      ),
    ).toBe(true);
  });

  it("keeps an orphaned run thread visible so it stays reachable", () => {
    expect(
      isAutomationRunThread(
        { automationRun: { automationId: AUTOMATION_ID, runId: AutomationRunId.make("run-1") } },
        automationMap(),
      ),
    ).toBe(false);
  });

  it("keeps ordinary threads", () => {
    expect(isAutomationRunThread({ automationRun: null }, automationMap(AUTOMATION))).toBe(false);
    expect(isAutomationRunThread({}, automationMap(AUTOMATION))).toBe(false);
  });
});

describe("groupAutomationRunsByDay", () => {
  it("labels the two most recent days in words and the rest by date", () => {
    const groups = groupAutomationRunsByDay(
      [
        run("run-1", "completed", "2026-09-06T10:00:00.000Z"),
        run("run-2", "completed", "2026-09-06T09:00:00.000Z"),
        run("run-3", "completed", "2026-09-05T09:00:00.000Z"),
        run("run-4", "completed", "2025-12-31T09:00:00.000Z"),
      ],
      "2026-09-06T12:00:00.000Z",
      "UTC",
    );

    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "Dec 31, 2025"]);
    expect(groups[0]?.runs).toHaveLength(2);
    expect(groups[0]?.key).toBe("2026-09-06");
  });

  it("splits days in the viewer's zone, not UTC", () => {
    const groups = groupAutomationRunsByDay(
      [
        // 09:00 and, four hours before UTC midnight rolls over, 23:00 the day before.
        run("run-1", "completed", "2026-09-06T13:00:00.000Z"),
        run("run-2", "completed", "2026-09-06T03:00:00.000Z"),
      ],
      "2026-09-06T18:00:00.000Z",
      "America/New_York",
    );

    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday"]);
  });

  it("returns nothing for an empty history", () => {
    expect(groupAutomationRunsByDay([], "2026-09-06T12:00:00.000Z", "UTC")).toEqual([]);
  });
});

describe("condenseAutomationRunGroup", () => {
  it("keeps the three newest runs and every failure, collapsing the rest", () => {
    const rows = condenseAutomationRunGroup([
      run("run-1", "completed", "2026-09-06T10:00:00.000Z"),
      run("run-2", "completed", "2026-09-06T09:00:00.000Z"),
      run("run-3", "completed", "2026-09-06T08:00:00.000Z"),
      run("run-4", "completed", "2026-09-06T07:00:00.000Z"),
      run("run-5", "skipped", "2026-09-06T06:00:00.000Z"),
      run("run-6", "missed", "2026-09-06T05:00:00.000Z"),
      run("run-7", "failed", "2026-09-06T04:00:00.000Z"),
      run("run-8", "completed", "2026-09-06T03:00:00.000Z"),
      run("run-9", "interrupted", "2026-09-06T02:00:00.000Z"),
    ]);

    expect(rows).toEqual([
      { kind: "run", run: expect.objectContaining({ id: "run-1" }) },
      { kind: "run", run: expect.objectContaining({ id: "run-2" }) },
      { kind: "run", run: expect.objectContaining({ id: "run-3" }) },
      {
        kind: "collapsed",
        count: 3,
        skipped: 1,
        missed: 1,
        runs: [
          expect.objectContaining({ id: "run-4" }),
          expect.objectContaining({ id: "run-5" }),
          expect.objectContaining({ id: "run-6" }),
        ],
      },
      { kind: "run", run: expect.objectContaining({ id: "run-7" }) },
      { kind: "run", run: expect.objectContaining({ id: "run-8" }) },
      { kind: "run", run: expect.objectContaining({ id: "run-9" }) },
    ]);
  });

  it("leaves a lone collapsible run as its own row", () => {
    const rows = condenseAutomationRunGroup([
      run("run-1", "completed", "2026-09-06T10:00:00.000Z"),
      run("run-2", "completed", "2026-09-06T09:00:00.000Z"),
      run("run-3", "completed", "2026-09-06T08:00:00.000Z"),
      run("run-4", "completed", "2026-09-06T07:00:00.000Z"),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["run", "run", "run", "run"]);
  });

  it("never collapses an in-flight run", () => {
    const rows = condenseAutomationRunGroup([
      run("run-1", "completed", "2026-09-06T10:00:00.000Z"),
      run("run-2", "completed", "2026-09-06T09:00:00.000Z"),
      run("run-3", "completed", "2026-09-06T08:00:00.000Z"),
      run("run-4", "completed", "2026-09-06T07:00:00.000Z"),
      run("run-5", "running", "2026-09-06T06:00:00.000Z"),
      run("run-6", "completed", "2026-09-06T05:00:00.000Z"),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["run", "run", "run", "run", "run", "run"]);
  });
});

describe("automationStatus", () => {
  const activeRun = {
    runId: AutomationRunId.make("run-1"),
    threadId: THREAD_ID,
    requestedAt: "2026-09-06T10:00:00.000Z",
    startedAt: "2026-09-06T10:00:01.000Z",
  };
  const waiting = { hasPendingApprovals: true, hasPendingUserInput: false };
  const busy = { hasPendingApprovals: false, hasPendingUserInput: false };

  it("ranks an approval prompt above a running run", () => {
    expect(automationStatus({ ...AUTOMATION, activeRun }, waiting)).toBe("needs-attention");
    expect(automationStatus({ ...AUTOMATION, activeRun }, busy)).toBe("running");
  });

  it("ranks a running run above a previous failure", () => {
    const failed = {
      runId: AutomationRunId.make("run-0"),
      status: "failed" as const,
      threadId: THREAD_ID,
      requestedAt: "2026-09-06T09:00:00.000Z",
      startedAt: "2026-09-06T09:00:01.000Z",
      finishedAt: "2026-09-06T09:05:00.000Z",
      error: "boom",
      summary: null,
    };
    expect(automationStatus({ ...AUTOMATION, activeRun, lastRun: failed }, busy)).toBe("running");
    expect(automationStatus({ ...AUTOMATION, lastRun: failed })).toBe("failed");
    expect(automationStatus({ ...AUTOMATION, enabled: false, lastRun: failed })).toBe("failed");
  });

  it("reports paused and idle", () => {
    expect(automationStatus({ ...AUTOMATION, enabled: false })).toBe("paused");
    expect(automationStatus(AUTOMATION)).toBe("idle");
  });
});

describe("automationNeedsAttention", () => {
  const failedRun = {
    runId: AutomationRunId.make("run-1"),
    status: "failed" as const,
    threadId: THREAD_ID,
    requestedAt: "2026-09-06T09:00:00.000Z",
    startedAt: "2026-09-06T09:00:01.000Z",
    finishedAt: "2026-09-06T09:05:00.000Z",
    error: "boom",
    summary: null,
  };

  it("counts a failure nobody has looked at since it finished", () => {
    expect(
      automationNeedsAttention({ ...AUTOMATION, lastRun: failedRun }, null, {
        lastVisitedAt: null,
      }),
    ).toBe(true);
    expect(
      automationNeedsAttention({ ...AUTOMATION, lastRun: failedRun }, null, {
        lastVisitedAt: "2026-09-06T09:00:30.000Z",
      }),
    ).toBe(true);
  });

  it("clears once the run thread has been visited", () => {
    expect(
      automationNeedsAttention({ ...AUTOMATION, lastRun: failedRun }, null, {
        lastVisitedAt: "2026-09-06T09:06:00.000Z",
      }),
    ).toBe(false);
  });

  it("never badges a failure with no thread to visit", () => {
    expect(
      automationNeedsAttention(
        { ...AUTOMATION, lastRun: { ...failedRun, threadId: null } },
        null,
        null,
      ),
    ).toBe(false);
    // Thread removed by the executor's failure cleanup: same answer.
    expect(automationNeedsAttention({ ...AUTOMATION, lastRun: failedRun }, null, null)).toBe(false);
  });

  it("counts an active run waiting on the user", () => {
    const shell = {
      ...AUTOMATION,
      activeRun: {
        runId: AutomationRunId.make("run-2"),
        threadId: THREAD_ID,
        requestedAt: "2026-09-06T10:00:00.000Z",
        startedAt: "2026-09-06T10:00:01.000Z",
      },
    };
    expect(
      automationNeedsAttention(
        shell,
        { hasPendingApprovals: false, hasPendingUserInput: true },
        null,
      ),
    ).toBe(true);
    expect(
      automationNeedsAttention(
        shell,
        { hasPendingApprovals: false, hasPendingUserInput: false },
        null,
      ),
    ).toBe(false);
  });

  it("ignores successful runs", () => {
    expect(
      automationNeedsAttention(
        { ...AUTOMATION, lastRun: { ...failedRun, status: "completed" } },
        null,
        { lastVisitedAt: null },
      ),
    ).toBe(false);
  });
});

describe("formatUntilLabel", () => {
  const now = Date.parse("2026-09-06T12:00:00.000Z");

  it("counts down in the largest useful unit", () => {
    expect(formatUntilLabel("2026-09-06T12:03:00.000Z", now)).toBe("in 3m");
    expect(formatUntilLabel("2026-09-06T14:00:00.000Z", now)).toBe("in 2h");
    expect(formatUntilLabel("2026-09-09T12:00:00.000Z", now)).toBe("in 3d");
    expect(formatUntilLabel("2026-09-06T12:00:20.000Z", now)).toBe("in 1m");
  });

  it("reads now for a due or past instant", () => {
    expect(formatUntilLabel("2026-09-06T12:00:00.000Z", now)).toBe("now");
    expect(formatUntilLabel("2026-09-06T11:00:00.000Z", now)).toBe("now");
  });
});
