/**
 * Home-screen helpers that stay out of the React tree so they can be tested
 * without rendering cards.
 */

/**
 * Last "Start in" project for this environment, or the first sidebar project
 * when nothing is remembered or the remembered id is gone.
 */
export function resolveExploreProjectId(
  rememberedId: string | null | undefined,
  projectIds: ReadonlyArray<string>,
): string | null {
  if (rememberedId !== null && rememberedId !== undefined && projectIds.includes(rememberedId)) {
    return rememberedId;
  }
  return projectIds[0] ?? null;
}

export function rememberExploreProjectId(
  current: Readonly<Record<string, string>>,
  environmentId: string,
  projectId: string,
): Record<string, string> {
  if (current[environmentId] === projectId) {
    return current as Record<string, string>;
  }
  return { ...current, [environmentId]: projectId };
}

function zonedParts(
  ms: number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale = "en-US",
): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(ms));
  }
}

function calendarDay(ms: number, timeZone: string): string {
  return zonedParts(ms, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA");
}

function nextCalendarDay(yyyyMmDd: string): string {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return yyyyMmDd;
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Labels `nextRunAt` in the environment timezone the schedule was computed
 * in, not the browser's. Remote clients otherwise call 09:00 "today at 2:00 AM".
 */
export function formatNextRun(iso: string, timeZone: string, nowMs: number = Date.now()): string {
  const runMs = Date.parse(iso);
  if (Number.isNaN(runMs)) return "soon";
  if (runMs <= nowMs) return "any moment now";
  const time = zonedParts(runMs, timeZone, { hour: "numeric", minute: "2-digit" });
  const today = calendarDay(nowMs, timeZone);
  const runDay = calendarDay(runMs, timeZone);
  if (runDay === today) return `today at ${time}`;
  if (runDay === nextCalendarDay(today)) return `tomorrow at ${time}`;
  const day = zonedParts(runMs, timeZone, { weekday: "short", month: "short", day: "numeric" });
  return `${day} at ${time}`;
}
