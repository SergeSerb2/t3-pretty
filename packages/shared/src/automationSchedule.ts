/**
 * Pure schedule helpers for automations, shared by the server projector, the
 * web editor, and the mobile list. Everything takes its "now" as a parameter
 * so previews are deterministic and testable; nothing here reads the clock.
 */
import type {
  AutomationEventName,
  AutomationRunTrigger,
  AutomationTrigger,
  IsoDateTime,
} from "@t3tools/contracts";
import { automationCronNext, validateAutomationCron } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

export { validateAutomationCron };

export const automationSchedulePresets = [
  { id: "hourly", label: "Every hour", cron: "0 * * * *" },
  { id: "daily", label: "Daily at 09:00", cron: "0 9 * * *" },
  { id: "weekdays", label: "Weekdays at 09:00", cron: "0 9 * * 1-5" },
  { id: "weekly", label: "Weekly on Monday at 09:00", cron: "0 9 * * 1" },
  { id: "custom", label: "Custom", cron: null },
] as const;
export type AutomationSchedulePresetId = (typeof automationSchedulePresets)[number]["id"];

const isSchedule = (
  trigger: AutomationTrigger,
): trigger is Extract<AutomationTrigger, { type: "schedule" }> => trigger.type === "schedule";

/** Upcoming instants of one schedule trigger after `from`, invalid schedules yield none. */
function* scheduleInstants(
  trigger: Extract<AutomationTrigger, { type: "schedule" }>,
  from: DateTime.Utc,
): Generator<DateTime.Utc> {
  const parsed = validateAutomationCron(trigger.cron, trigger.timezone);
  if (Result.isFailure(parsed)) {
    return;
  }
  let cursor: DateTime.Utc | null = from;
  while (cursor !== null) {
    cursor = automationCronNext(parsed.success, cursor);
    if (cursor !== null) {
      yield cursor;
    }
  }
}

/**
 * The next `count` instants across every schedule trigger, ascending and
 * deduplicated. Powers the editor's "next runs" line and the MCP preview.
 */
export function nextRunPreview(
  triggers: ReadonlyArray<AutomationTrigger>,
  fromIso: IsoDateTime,
  count: number,
): ReadonlyArray<IsoDateTime> {
  const from = DateTime.make(fromIso);
  if (Option.isNone(from) || count <= 0) {
    return [];
  }
  const instants = new Set<number>();
  for (const trigger of triggers.filter(isSchedule)) {
    let taken = 0;
    for (const instant of scheduleInstants(trigger, from.value)) {
      instants.add(DateTime.toEpochMillis(instant));
      if (++taken >= count) {
        break;
      }
    }
  }
  return [...instants]
    .sort((a, b) => a - b)
    .slice(0, count)
    .map((millis) => DateTime.formatIso(DateTime.makeUnsafe(millis)));
}

/** Earliest schedule instant strictly after `fromIso`; null when paused or unscheduled. */
export function nextAutomationRunAt(
  triggers: ReadonlyArray<AutomationTrigger>,
  enabled: boolean,
  fromIso: IsoDateTime,
): IsoDateTime | null {
  return enabled ? (nextRunPreview(triggers, fromIso, 1)[0] ?? null) : null;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const clock = (hour: string, minute: string) =>
  `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

/**
 * Short human label for a cron, best effort: presets and the common
 * "at HH:MM" / "every N" shapes get prose, anything else shows the raw
 * expression. Clock times carry the zone so a remote user knows whose 09:00.
 */
export function describeAutomationSchedule(cron: string, timezone: string): string {
  const fields = cron.trim().split(/\s+/u);
  if (fields.length !== 5) {
    return cron;
  }
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  const isNumber = (field: string) => /^\d{1,2}$/u.test(field);
  const every = (field: string) => /^\*\/\d+$/u.exec(field)?.[0].slice(2) ?? null;
  const withZone = (label: string) => `${label} (${timezone})`;

  if (day === "*" && month === "*") {
    if (isNumber(minute) && isNumber(hour)) {
      const at = clock(hour, minute);
      if (weekday === "*") return withZone(`Daily at ${at}`);
      if (weekday === "1-5") return withZone(`Weekdays at ${at}`);
      if (isNumber(weekday) && Number(weekday) <= 6) {
        return withZone(`Every ${WEEKDAY_NAMES[Number(weekday)]} at ${at}`);
      }
    }
    if (weekday === "*") {
      if (isNumber(minute) && hour === "*") {
        return minute === "0" ? "Every hour" : `Every hour at :${minute.padStart(2, "0")}`;
      }
      const everyMinutes = every(minute);
      if (everyMinutes !== null && hour === "*") return `Every ${everyMinutes} minutes`;
      const everyHours = every(hour);
      if (isNumber(minute) && everyHours !== null) return `Every ${everyHours} hours`;
    }
  }
  return `${cron} (${timezone})`;
}

/** Honest labels: PR merges are only observed when performed inside T3. */
export const AUTOMATION_EVENT_LABELS: Record<AutomationEventName, string> = {
  "turn.completed": "Turn completed",
  "turn.failed": "Turn failed",
  "pull-request.merged": "Pull request merged in T3",
};

/** Short label for a run row's trigger column. */
export function automationRunTriggerLabel(trigger: AutomationRunTrigger): string {
  switch (trigger.type) {
    case "schedule":
      return trigger.catchUp ? "Scheduled (catch-up)" : "Scheduled";
    case "manual":
      return "Run now";
    case "event":
      return AUTOMATION_EVENT_LABELS[trigger.event];
    case "webhook":
      return "Webhook";
    case "git":
      return `Push to ${trigger.branch}`;
  }
}
