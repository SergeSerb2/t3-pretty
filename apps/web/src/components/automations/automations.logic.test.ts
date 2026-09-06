import type { EnvironmentAutomation } from "@t3tools/client-runtime/state/automations";
import {
  AutomationId,
  AutomationRunId,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  automationRunDurationMs,
  automationRunStatusVisual,
  automationSetupPrompt,
  automationStatusVisual,
  automationTriggerIcon,
  collapsedRunRowLabel,
  composeWebhookUrl,
  countAutomationsNeedingAttention,
  describeAutomationTrigger,
  isLoopbackUrl,
} from "./automations.logic";

const environmentId = EnvironmentId.make("env-1");

function automation(overrides: Partial<EnvironmentAutomation> = {}): EnvironmentAutomation {
  return {
    environmentId,
    id: AutomationId.make("auto-1"),
    projectId: ProjectId.make("project-1"),
    name: "Nightly triage",
    prompt: "Triage issues",
    enabled: true,
    triggers: [],
    modelSelection: null,
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
    nextRunAt: null,
    activeRun: null,
    lastRun: null,
    lastRequestedAt: null,
    pendingTrigger: null,
    consecutiveFailures: 0,
    runCount: 0,
    webhookPath: null,
    ...overrides,
  };
}

describe("status visuals", () => {
  it("maps every automation status onto the shared vocabulary", () => {
    expect(automationStatusVisual("running")).toBe("running");
    expect(automationStatusVisual("needs-attention")).toBe("attention");
    expect(automationStatusVisual("failed")).toBe("failed");
    expect(automationStatusVisual("paused")).toBe("paused");
    expect(automationStatusVisual("idle")).toBe("ready");
  });

  it("keeps uneventful run statuses muted", () => {
    expect(automationRunStatusVisual("requested")).toBe("pending");
    expect(automationRunStatusVisual("failed")).toBe("failed");
    expect(automationRunStatusVisual("interrupted")).toBe("interrupted");
    expect(automationRunStatusVisual("skipped")).toBe("skipped");
    expect(automationRunStatusVisual("missed")).toBe("missed");
  });
});

describe("trigger presentation", () => {
  it("assigns one icon per trigger kind", () => {
    expect(automationTriggerIcon("schedule")).toBe("clock");
    expect(automationTriggerIcon("manual")).toBe("hand");
    expect(automationTriggerIcon("event")).toBe("zap");
    expect(automationTriggerIcon("webhook")).toBe("webhook");
    expect(automationTriggerIcon("git")).toBe("git");
  });

  it("labels configured triggers honestly", () => {
    expect(
      describeAutomationTrigger({
        type: "schedule",
        cron: "0 9 * * 1-5",
        timezone: "Europe/Berlin",
      }),
    ).toBe("Weekdays at 09:00 (Europe/Berlin)");
    expect(describeAutomationTrigger({ type: "event", event: "pull-request.merged" })).toBe(
      "Pull request merged in T3",
    );
    expect(describeAutomationTrigger({ type: "git", branch: null })).toBe("Push to default branch");
    expect(describeAutomationTrigger({ type: "git", branch: "release" })).toBe("Push to release");
    expect(describeAutomationTrigger({ type: "webhook" })).toBe("Webhook");
  });
});

describe("webhook url", () => {
  it("composes the client's base url with the server path", () => {
    expect(composeWebhookUrl("http://127.0.0.1:3000/", "/hooks/automations/a/t")).toBe(
      "http://127.0.0.1:3000/hooks/automations/a/t",
    );
    expect(composeWebhookUrl(null, "/hooks/automations/a/t")).toBeNull();
    expect(composeWebhookUrl("https://box.tail.ts.net", null)).toBeNull();
  });

  it("flags loopback origins only", () => {
    expect(isLoopbackUrl("http://127.0.0.1:3000/hooks/x")).toBe(true);
    expect(isLoopbackUrl("http://localhost:3000/hooks/x")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:3000/hooks/x")).toBe(true);
    expect(isLoopbackUrl("http://dev.localhost:3000/hooks/x")).toBe(true);
    expect(isLoopbackUrl("https://box.tail.ts.net/hooks/x")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });
});

describe("countAutomationsNeedingAttention", () => {
  const threadId = ThreadId.make("thread-1");
  const threadKey = `${environmentId}:${threadId}`;
  const lastRun = {
    runId: AutomationRunId.make("run-1"),
    status: "failed" as const,
    threadId,
    requestedAt: "2026-09-06T09:00:00.000Z",
    startedAt: "2026-09-06T09:00:05.000Z",
    finishedAt: "2026-09-06T09:10:00.000Z",
    error: "boom",
    summary: null,
  };

  const runThread = { hasPendingApprovals: false, hasPendingUserInput: false };

  it("counts an unvisited failed run and clears once visited after it finished", () => {
    const failed = automation({ lastRun });
    const runThreadByKey = new Map([[threadKey, runThread]]);
    expect(
      countAutomationsNeedingAttention([failed], {
        runThreadByKey,
        lastVisitedAtByThreadKey: {},
      }),
    ).toBe(1);
    expect(
      countAutomationsNeedingAttention([failed], {
        runThreadByKey,
        lastVisitedAtByThreadKey: { [threadKey]: "2026-09-06T09:20:00.000Z" },
      }),
    ).toBe(0);
    expect(
      countAutomationsNeedingAttention([failed], {
        runThreadByKey,
        lastVisitedAtByThreadKey: { [threadKey]: "2026-09-06T09:05:00.000Z" },
      }),
    ).toBe(1);
  });

  it("does not count a failed run whose thread is missing or never existed", () => {
    expect(
      countAutomationsNeedingAttention([automation({ lastRun })], {
        runThreadByKey: new Map(),
        lastVisitedAtByThreadKey: {},
      }),
    ).toBe(0);
    expect(
      countAutomationsNeedingAttention([automation({ lastRun: { ...lastRun, threadId: null } })], {
        runThreadByKey: new Map([[threadKey, runThread]]),
        lastVisitedAtByThreadKey: {},
      }),
    ).toBe(0);
  });

  it("counts an active run whose thread is waiting on the user", () => {
    const active = automation({
      activeRun: {
        runId: AutomationRunId.make("run-2"),
        threadId,
        requestedAt: "2026-09-06T10:00:00.000Z",
        startedAt: "2026-09-06T10:00:02.000Z",
      },
    });
    expect(
      countAutomationsNeedingAttention([active], {
        runThreadByKey: new Map([
          [threadKey, { hasPendingApprovals: true, hasPendingUserInput: false }],
        ]),
        lastVisitedAtByThreadKey: {},
      }),
    ).toBe(1);
    expect(
      countAutomationsNeedingAttention([active], {
        runThreadByKey: new Map([
          [threadKey, { hasPendingApprovals: false, hasPendingUserInput: false }],
        ]),
        lastVisitedAtByThreadKey: {},
      }),
    ).toBe(0);
  });
});

describe("misc", () => {
  it("names the toolkit in the setup prompt and the automation in the edit prompt", () => {
    expect(automationSetupPrompt()).toContain("t3-code-automations");
    expect(automationSetupPrompt({ name: "Nightly", id: "auto-9" })).toContain(
      '"Nightly" (id auto-9)',
    );
  });

  it("measures live runs against now and finished runs against finishedAt", () => {
    const startedAt = "2026-09-06T10:00:00.000Z";
    expect(automationRunDurationMs({ startedAt: null, finishedAt: null }, 0)).toBeNull();
    expect(
      automationRunDurationMs({ startedAt, finishedAt: null }, Date.parse(startedAt) + 5_000),
    ).toBe(5_000);
    expect(automationRunDurationMs({ startedAt, finishedAt: "2026-09-06T10:01:00.000Z" }, 0)).toBe(
      60_000,
    );
  });

  it("labels collapsed rows with only the non-zero parts", () => {
    expect(collapsedRunRowLabel({ count: 4, skipped: 0, missed: 0 })).toBe("4 more runs");
    expect(collapsedRunRowLabel({ count: 4, skipped: 1, missed: 2 })).toBe(
      "4 more runs · 1 skipped · 2 missed",
    );
  });
});
