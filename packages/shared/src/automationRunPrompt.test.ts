import { AutomationRunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyAutomationRunSuffix,
  AUTOMATION_RUN_CLOSE_MARKER,
  AUTOMATION_RUN_OPEN_MARKER,
  buildAutomationRunSuffix,
} from "./automationRunPrompt.ts";
import { stripHiddenInstructionSuffixes } from "./hiddenInstructionBlocks.ts";

const base = {
  automationName: "Nightly triage",
  projectTitle: "t3-pretty",
  runId: AutomationRunId.make("run-1"),
  startedAt: "2026-09-06T07:00:00.000Z",
};

describe("buildAutomationRunSuffix", () => {
  it("wraps the unattended instructions with the trigger description", () => {
    const suffix = buildAutomationRunSuffix({
      ...base,
      trigger: { type: "schedule", scheduledFor: "2026-09-06T07:00:00.000Z", catchUp: false },
    });
    expect(suffix.startsWith(`\n\n${AUTOMATION_RUN_OPEN_MARKER}\n`)).toBe(true);
    expect(suffix.endsWith(`\n${AUTOMATION_RUN_CLOSE_MARKER}`)).toBe(true);
    expect(suffix).toContain('automation "Nightly triage" for project t3-pretty (run run-1');
    expect(suffix).toContain("triggered by its schedule (due at 2026-09-06T07:00:00.000Z)");
    expect(suffix).toContain("Nobody is watching");
    expect(suffix).not.toContain("Previous run");
    expect(suffix).not.toContain("Webhook payload");
  });

  it("includes the previous summary and fences a webhook payload", () => {
    const suffix = buildAutomationRunSuffix({
      ...base,
      trigger: { type: "webhook", deliveryId: "gh-42", payload: '{"action":"opened"}' },
      previousRunSummary: { finishedAt: "2026-09-05T07:10:00.000Z", summary: "Closed 3 issues." },
    });
    expect(suffix).toContain("triggered by a webhook delivery (gh-42)");
    expect(suffix).toContain("Previous run (2026-09-05T07:10:00.000Z) summary:\nClosed 3 issues.");
    expect(suffix).toContain('Webhook payload:\n```json\n{"action":"opened"}\n```');
  });
});

describe("applyAutomationRunSuffix", () => {
  const input = {
    ...base,
    trigger: { type: "manual", byThreadId: null } as const,
  };

  it("appends once and strips cleanly", () => {
    const text = applyAutomationRunSuffix("Triage the inbox", input);
    expect(text).toContain("triggered by a user pressing Run now");
    expect(applyAutomationRunSuffix(text, input)).toBe(text);
    expect(stripHiddenInstructionSuffixes(text)).toBe("Triage the inbox");
  });
});
