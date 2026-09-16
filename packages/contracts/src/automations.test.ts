import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AUTOMATION_WEBHOOK_PAYLOAD_MAX_CHARS,
  Automation,
  AutomationEditableFields,
  AutomationRunTrigger,
  AutomationScheduleTrigger,
  AutomationsListRunsInput,
  validateAutomationCron,
} from "./automations.ts";
import {
  ClientOrchestrationCommand,
  OrchestrationCommand,
  OrchestrationShellSnapshot,
  OrchestrationThreadShell,
} from "./orchestration.ts";

const decodeSchedule = Schema.decodeUnknownSync(AutomationScheduleTrigger);
const decodeEditable = Schema.decodeUnknownSync(AutomationEditableFields);
const decodeRunTrigger = Schema.decodeUnknownSync(AutomationRunTrigger);
const decodeAutomation = Schema.decodeUnknownSync(Automation);
const decodeSnapshot = Schema.decodeUnknownSync(OrchestrationShellSnapshot);
const decodeListRunsInput = Schema.decodeUnknownSync(AutomationsListRunsInput);
const isClientCommand = Schema.is(ClientOrchestrationCommand);
const isCommand = Schema.is(OrchestrationCommand);

describe("AutomationScheduleTrigger", () => {
  it("accepts a five-field cron with an IANA zone", () => {
    expect(
      decodeSchedule({ type: "schedule", cron: "0 9 * * *", timezone: "Europe/Berlin" }),
    ).toEqual({ type: "schedule", cron: "0 9 * * *", timezone: "Europe/Berlin" });
  });

  it("requires the timezone", () => {
    expect(() => decodeSchedule({ type: "schedule", cron: "0 9 * * *" })).toThrow();
  });

  it("rejects six-field (seconds) expressions", () => {
    expect(() =>
      decodeSchedule({ type: "schedule", cron: "0 0 9 * * *", timezone: "UTC" }),
    ).toThrow(/exactly 5 fields/);
  });

  it("rejects unknown zones", () => {
    expect(() =>
      decodeSchedule({ type: "schedule", cron: "0 9 * * *", timezone: "Mars/Olympus" }),
    ).toThrow(/Unknown time zone/);
  });

  it("rejects schedules denser than five minutes", () => {
    expect(() => decodeSchedule({ type: "schedule", cron: "* * * * *", timezone: "UTC" })).toThrow(
      /at least 5 minutes/,
    );
    expect(Result.isSuccess(validateAutomationCron("*/5 * * * *", "UTC"))).toBe(true);
    // The first gap (58 minutes) passes; the wrap from :59 to :00 does not.
    expect(() =>
      decodeSchedule({ type: "schedule", cron: "0,59 * * * *", timezone: "UTC" }),
    ).toThrow(/at least 5 minutes/);
  });

  it("rejects schedules that never fire instead of throwing", () => {
    const result = validateAutomationCron("0 0 31 2 *", "UTC");
    expect(Result.isFailure(result) && result.failure).toBe("Schedule never fires");
  });
});

describe("Automation defaults", () => {
  it("fills editable-field defaults and leaves createPullRequest to the workspace", () => {
    const fields = decodeEditable({ name: "Nightly", prompt: "Do the thing", triggers: [] });
    expect(fields).toEqual({
      name: "Nightly",
      prompt: "Do the thing",
      triggers: [],
      enabled: true,
      modelSelection: null,
      runtimeMode: "full-access",
      workspace: "checkout",
      includeLastRunSummary: false,
      catchUpMissedRuns: true,
      minIntervalSeconds: 60,
      timeoutMinutes: 120,
    });
    expect("createPullRequest" in fields).toBe(false);
  });

  it("caps the trigger list at eight", () => {
    expect(() =>
      decodeEditable({
        name: "Busy",
        prompt: "x",
        triggers: Array.from({ length: 9 }, () => ({ type: "webhook" })),
      }),
    ).toThrow();
  });

  it("decodes a stored record without token or source thread", () => {
    const automation = decodeAutomation({
      id: "automation-1",
      projectId: "project-1",
      name: "Nightly",
      prompt: "Do the thing",
      triggers: [{ type: "git", branch: null }],
      createPullRequest: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(automation.webhookToken).toBeNull();
    expect(automation.sourceThreadId).toBeNull();
    expect(automation.enabled).toBe(true);
  });
});

describe("AutomationRunTrigger", () => {
  it("caps the webhook payload at 32 KB", () => {
    const payload = "x".repeat(AUTOMATION_WEBHOOK_PAYLOAD_MAX_CHARS);
    expect(decodeRunTrigger({ type: "webhook", deliveryId: "d1", payload }).type).toBe("webhook");
    expect(() =>
      decodeRunTrigger({ type: "webhook", deliveryId: "d1", payload: `${payload}x` }),
    ).toThrow();
  });
});

describe("orchestration wiring", () => {
  const base = { commandId: "cmd-1", automationId: "automation-1", runId: "run-1" };

  it("lets clients dispatch automation.run.request but not the internal run commands", () => {
    const request = {
      ...base,
      type: "automation.run.request",
      trigger: { type: "manual", byThreadId: null },
      requestedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(isClientCommand(request)).toBe(true);

    const finished = {
      ...base,
      type: "automation.run.finished",
      status: "completed",
      finishedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(isClientCommand(finished)).toBe(false);
    expect(isCommand(finished)).toBe(true);
  });

  it("defaults snapshot automations to none and thread automationRun to absent", () => {
    const snapshot = decodeSnapshot({
      snapshotSequence: 0,
      projects: [],
      threads: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(snapshot.automations).toEqual([]);
    expect(OrchestrationThreadShell.fields.automationRun).toBeDefined();
  });

  it("defaults the listRuns page size", () => {
    expect(decodeListRunsInput({ automationId: "automation-1" }).limit).toBe(50);
    expect(() => decodeListRunsInput({ automationId: "automation-1", limit: 201 })).toThrow();
  });
});
