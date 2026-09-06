import { type AutomationTrigger, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  automationRunTriggerLabel,
  describeAutomationSchedule,
  nextAutomationRunAt,
  nextRunPreview,
} from "./automationSchedule.ts";

const berlinHour = (iso: string) =>
  DateTime.toParts(DateTime.makeZonedUnsafe(iso, { timeZone: "Europe/Berlin" })).hour;

const daily: AutomationTrigger = { type: "schedule", cron: "0 9 * * *", timezone: "Europe/Berlin" };

describe("nextAutomationRunAt", () => {
  it("keeps 09:00 local across the spring DST switch", () => {
    // EU DST begins 2026-03-29 02:00 local: 09:00 is 08:00Z before and 07:00Z after.
    const first = nextAutomationRunAt([daily], true, "2026-03-28T12:00:00.000Z");
    expect(first).toBe("2026-03-29T07:00:00.000Z");
    const second = nextAutomationRunAt([daily], true, first!);
    expect(second).toBe("2026-03-30T07:00:00.000Z");
    expect(berlinHour(first!)).toBe(9);
    expect(berlinHour(second!)).toBe(9);
    expect(berlinHour(nextAutomationRunAt([daily], true, "2026-03-27T12:00:00.000Z")!)).toBe(9);
  });

  it("is null when paused or without a schedule trigger", () => {
    expect(nextAutomationRunAt([daily], false, "2026-03-28T12:00:00.000Z")).toBeNull();
    expect(nextAutomationRunAt([{ type: "webhook" }], true, "2026-03-28T12:00:00.000Z")).toBeNull();
  });

  it("is strictly after the given instant", () => {
    expect(nextAutomationRunAt([daily], true, "2026-03-30T07:00:00.000Z")).toBe(
      "2026-03-31T07:00:00.000Z",
    );
  });
});

describe("nextRunPreview", () => {
  it("merges several schedules in ascending order", () => {
    const hourly: AutomationTrigger = { type: "schedule", cron: "30 * * * *", timezone: "UTC" };
    expect(nextRunPreview([daily, hourly], "2026-06-01T06:45:00.000Z", 3)).toEqual([
      "2026-06-01T07:00:00.000Z",
      "2026-06-01T07:30:00.000Z",
      "2026-06-01T08:30:00.000Z",
    ]);
  });

  it("ignores invalid schedules and bad anchors", () => {
    const broken: AutomationTrigger = { type: "schedule", cron: "nope", timezone: "UTC" };
    expect(nextRunPreview([broken], "2026-06-01T06:45:00.000Z", 3)).toEqual([]);
    expect(nextRunPreview([daily], "not a date", 3)).toEqual([]);
  });
});

describe("describeAutomationSchedule", () => {
  it("labels the common shapes", () => {
    expect(describeAutomationSchedule("0 9 * * *", "Europe/Berlin")).toBe(
      "Daily at 09:00 (Europe/Berlin)",
    );
    expect(describeAutomationSchedule("0 9 * * 1-5", "UTC")).toBe("Weekdays at 09:00 (UTC)");
    expect(describeAutomationSchedule("30 18 * * 1", "UTC")).toBe("Every Monday at 18:30 (UTC)");
    expect(describeAutomationSchedule("0 * * * *", "UTC")).toBe("Every hour");
    expect(describeAutomationSchedule("*/15 * * * *", "UTC")).toBe("Every 15 minutes");
    expect(describeAutomationSchedule("0 */6 * * *", "UTC")).toBe("Every 6 hours");
    expect(describeAutomationSchedule("0 9 1 * *", "UTC")).toBe("0 9 1 * * (UTC)");
  });
});

describe("automationRunTriggerLabel", () => {
  it("names each trigger honestly", () => {
    expect(automationRunTriggerLabel({ type: "schedule", scheduledFor: "x", catchUp: true })).toBe(
      "Scheduled (catch-up)",
    );
    expect(
      automationRunTriggerLabel({
        type: "event",
        event: "pull-request.merged",
        threadId: ThreadId.make("t"),
      }),
    ).toBe("Pull request merged in T3");
    expect(
      automationRunTriggerLabel({ type: "git", branch: "main", fromCommit: null, toCommit: "abc" }),
    ).toBe("Push to main");
  });
});
