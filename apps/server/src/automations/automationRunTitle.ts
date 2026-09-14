/**
 * Naming for automation run threads and their worktree branches. The title
 * carries a short local time so a shelf of runs reads like a log; the branch
 * deliberately sits outside the `t3code/<hex>` temp pattern so the first-turn
 * branch renamer leaves it alone.
 */
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

function partsIn(at: DateTime.Utc, timezone: string | null): DateTime.DateTime.PartsWithWeekday {
  const zone = timezone === null ? Option.none() : DateTime.zoneMakeNamed(timezone);
  return DateTime.toParts(Option.isSome(zone) ? DateTime.setZone(at, zone.value) : at);
}

/** `Nightly review · Sep 6, 09:00`, clock in the schedule's zone (else UTC). */
export function automationRunTitle(
  name: string,
  at: DateTime.Utc,
  timezone: string | null,
): string {
  const parts = partsIn(at, timezone);
  return `${name} · ${MONTHS[parts.month - 1]} ${parts.day}, ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** `automation/nightly-review/20260906-0900`; the stamp is UTC so it never collides across zones. */
export function automationRunBranchName(name: string, at: DateTime.Utc): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "run";
  const parts = DateTime.toPartsUtc(at);
  const stamp = `${parts.year}${pad(parts.month)}${pad(parts.day)}-${pad(parts.hour)}${pad(parts.minute)}`;
  return `automation/${slug}/${stamp}`;
}
