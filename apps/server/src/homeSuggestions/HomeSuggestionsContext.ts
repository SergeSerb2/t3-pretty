/**
 * HomeSuggestionsContext - the pure half of home suggestions.
 *
 * Picks which threads describe the developer's recent work, renders them into
 * the digest the model reads, turns the model's answer back into cards, and
 * computes when the next daily batch is due. Nothing here touches the clock,
 * the disk, or a provider, so the service stays thin and the rules test flat.
 *
 * @module HomeSuggestionsContext
 */
import {
  HOME_SUGGESTIONS_EXPLORE_COUNT,
  HOME_SUGGESTIONS_PROJECT_COUNT,
  HomeSuggestionId,
  type HomeSuggestion,
  type HomeSuggestionsTime,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  type ProjectId,
} from "@t3tools/contracts";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { stripHiddenInstructionSuffixes } from "@t3tools/shared/hiddenInstructionBlocks";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import type { GeneratedHomeSuggestion } from "../textGeneration/TextGeneration.ts";

/** Threads read per batch; the newest across every project. */
export const HOME_SUGGESTIONS_MAX_THREADS = 40;
/** A single busy project cannot crowd the others out of the digest. */
export const HOME_SUGGESTIONS_MAX_THREADS_PER_PROJECT = 8;
const FIRST_MESSAGE_MAX_CHARS = 700;
const LAST_MESSAGE_MAX_CHARS = 500;
const TITLE_MAX_CHARS = 120;
const SUMMARY_MAX_CHARS = 300;
const PROMPT_MAX_CHARS = 4_000;
/** Titles remembered across batches so tomorrow's cards do not repeat today's. */
export const HOME_SUGGESTIONS_TITLE_MEMORY = 40;

export interface DigestThread {
  readonly shell: OrchestrationThreadShell;
  readonly messages: ReadonlyArray<Pick<OrchestrationMessage, "role" | "text">>;
}

const byUpdatedAtDesc = (left: OrchestrationThreadShell, right: OrchestrationThreadShell) =>
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id);

/**
 * Newest live threads first, capped overall and per project, so the digest
 * reflects what the developer touched last without reading the whole history.
 */
export function selectDigestThreads(
  threads: ReadonlyArray<OrchestrationThreadShell>,
  projects: ReadonlyArray<OrchestrationProjectShell>,
): ReadonlyArray<OrchestrationThreadShell> {
  const projectIds = new Set(projects.map((project) => project.id));
  const perProject = new Map<ProjectId, number>();
  const selected: OrchestrationThreadShell[] = [];
  for (const thread of [...threads].sort(byUpdatedAtDesc)) {
    if (thread.archivedAt !== null || !projectIds.has(thread.projectId)) continue;
    const count = perProject.get(thread.projectId) ?? 0;
    if (count >= HOME_SUGGESTIONS_MAX_THREADS_PER_PROJECT) continue;
    perProject.set(thread.projectId, count + 1);
    selected.push(thread);
    if (selected.length >= HOME_SUGGESTIONS_MAX_THREADS) break;
  }
  return selected;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function messageText(message: Pick<OrchestrationMessage, "role" | "text">): string {
  const text =
    message.role === "assistant"
      ? assistantCitationsToPlainText(message.text)
      : stripHiddenInstructionSuffixes(message.text);
  return text.replace(/\s+/g, " ").trim();
}

/** Same zone fallback as `nextHomeSuggestionsRunAt`: named IANA zone, else UTC. */
function inNamedZone(ms: number, timeZone: string) {
  const instant = DateTime.makeUnsafe(ms);
  return Option.getOrElse(DateTime.setZoneNamed(instant, timeZone), () =>
    DateTime.setZoneNamed(instant, "UTC").pipe(Option.getOrThrow),
  );
}

/** Calendar day number in `timeZone`, so "yesterday" follows the user's clock, not UTC's. */
function calendarDayNumber(ms: number, timeZone: string): number | null {
  if (!Number.isFinite(ms)) return null;
  const parts = DateTime.toParts(inNamedZone(ms, timeZone));
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

function relativeDay(nowMs: number, iso: string, timeZone: string): string {
  const today = calendarDayNumber(nowMs, timeZone);
  const day = calendarDayNumber(Date.parse(iso), timeZone);
  if (today === null || day === null) return "today";
  const days = today - day;
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function projectKey(index: number): string {
  return `P${index + 1}`;
}

/**
 * Renders projects and their recent threads for the model. Projects are
 * ordered by last activity and keyed P1, P2, ... so the model can name the
 * project a card belongs to without echoing paths back.
 */
export function buildHomeSuggestionsDigest(input: {
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: ReadonlyArray<DigestThread>;
  readonly nowMs: number;
  /** The schedule's zone, so day labels match the user's calendar. */
  readonly timeZone: string;
}): { readonly context: string; readonly projectsByKey: ReadonlyMap<string, ProjectId> } {
  const latestByProject = new Map<ProjectId, number>();
  for (const thread of input.threads) {
    const updated = Date.parse(thread.shell.updatedAt);
    const current = latestByProject.get(thread.shell.projectId) ?? 0;
    if (updated > current) latestByProject.set(thread.shell.projectId, updated);
  }
  const projects = [...input.projects].sort(
    (left, right) =>
      (latestByProject.get(right.id) ?? Date.parse(right.updatedAt)) -
        (latestByProject.get(left.id) ?? Date.parse(left.updatedAt)) ||
      left.title.localeCompare(right.title),
  );
  const projectsByKey = new Map<string, ProjectId>();
  const sections: string[] = [];
  projects.forEach((project, index) => {
    const key = projectKey(index);
    projectsByKey.set(key, project.id);
    const folder = /[^\\/]+(?=[\\/]*$)/.exec(project.workspaceRoot)?.[0] ?? "";
    const threads = input.threads.filter((thread) => thread.shell.projectId === project.id);
    const lines = [`## ${key}: ${project.title}${folder ? ` (folder: ${folder})` : ""}`];
    if (threads.length === 0) {
      lines.push("No recent threads.");
    }
    for (const thread of threads) {
      const first = thread.messages.find((message) => message.role === "user");
      const last = thread.messages.findLast((message) => message.role === "assistant");
      const status = thread.shell.latestTurn?.state ?? "idle";
      lines.push(
        `- ${clip(thread.shell.title, TITLE_MAX_CHARS)} (${relativeDay(input.nowMs, thread.shell.updatedAt, input.timeZone)}, last turn ${status})`,
      );
      const firstText = first ? messageText(first) : "";
      if (firstText) lines.push(`  Asked: ${clip(firstText, FIRST_MESSAGE_MAX_CHARS)}`);
      const lastText = last ? messageText(last) : "";
      if (lastText) lines.push(`  Outcome: ${clip(lastText, LAST_MESSAGE_MAX_CHARS)}`);
    }
    sections.push(lines.join("\n"));
  });
  return { context: sections.join("\n\n"), projectsByKey };
}

/**
 * Validates the model's cards: drops empty or malformed ones, resolves the
 * project key, keeps the requested mix, and stamps ids.
 */
export function mapGeneratedSuggestions(input: {
  readonly generated: ReadonlyArray<GeneratedHomeSuggestion>;
  readonly projectsByKey: ReadonlyMap<string, ProjectId>;
  readonly makeId: (index: number) => string;
}): ReadonlyArray<HomeSuggestion> {
  const seenTitles = new Set<string>();
  const cards: HomeSuggestion[] = [];
  let projectCount = 0;
  let exploreCount = 0;
  for (const candidate of input.generated) {
    const title = clip(candidate.title, TITLE_MAX_CHARS);
    const prompt = clip(candidate.prompt, PROMPT_MAX_CHARS);
    if (!title || !prompt || seenTitles.has(title.toLowerCase())) continue;
    const projectId = input.projectsByKey.get(candidate.projectKey.trim()) ?? null;
    // A project card that names no known project is still useful as an idea.
    const kind = candidate.kind === "project" && projectId !== null ? "project" : "explore";
    if (kind === "project") {
      if (projectCount >= HOME_SUGGESTIONS_PROJECT_COUNT) continue;
      projectCount += 1;
    } else {
      if (exploreCount >= HOME_SUGGESTIONS_EXPLORE_COUNT) continue;
      exploreCount += 1;
    }
    seenTitles.add(title.toLowerCase());
    cards.push({
      id: HomeSuggestionId.make(input.makeId(cards.length)),
      kind,
      projectId: kind === "project" ? projectId : null,
      title,
      summary: clip(candidate.summary, SUMMARY_MAX_CHARS),
      prompt,
    });
  }
  return cards;
}

/** Keeps the newest titles so the avoid-list stays bounded. */
export function rememberTitles(
  previous: ReadonlyArray<string>,
  batch: ReadonlyArray<HomeSuggestion>,
): ReadonlyArray<string> {
  return [...batch.map((card) => card.title), ...previous].slice(0, HOME_SUGGESTIONS_TITLE_MEMORY);
}

/**
 * The first instant strictly after `afterMs` at which the local wall clock in
 * `timeZone` reads `time`. Falls back to UTC when the zone is unknown.
 */
export function nextHomeSuggestionsRunAt(input: {
  readonly time: HomeSuggestionsTime;
  readonly afterMs: number;
  readonly timeZone: string;
}): number {
  const [hoursText, minutesText] = input.time.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const zoned = inNamedZone(input.afterMs, input.timeZone);
  const wallClock = { hour: hours, minute: minutes, second: 0, millisecond: 0 };
  const candidate = DateTime.setParts(zoned, wallClock);
  const next =
    DateTime.toEpochMillis(candidate) > input.afterMs
      ? candidate
      : DateTime.setParts(DateTime.add(zoned, { days: 1 }), wallClock);
  return DateTime.toEpochMillis(next);
}
