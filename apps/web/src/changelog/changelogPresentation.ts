/**
 * Turns raw changelog releases into the copy and grouping the What's New UI
 * actually shows. Nightly builds overlap heavily and titles often arrive as
 * commit subjects; this layer is what makes the dialog readable.
 */
import type { ChangelogItem, ChangelogItemKind, ChangelogRelease } from "./changelogData";

const MAINTENANCE_ONLY_TITLE = "Under-the-hood stability and maintenance";
const KIND_ORDER = ["new", "improved", "fixed"] as const satisfies readonly ChangelogItemKind[];
const KIND_HEADING: Record<ChangelogItemKind, string> = {
  new: "New",
  improved: "Improvements",
  fixed: "Fixes",
};
/** Post-update dialog only — keep it a short read. Settings still shows the rest. */
const UPDATE_DIGEST_ITEM_LIMIT = 12;
const LEADING_ADD = /^(?:add|added)\s+/iu;
const TRAILING_PR = /\s*\(#\d+\)\s*$/u;
const CONTRIBUTOR_ONLY =
  /\b(typecheck|upstream sync|github actions?|sigkill|vitest|eslint|prettier|packaging step)\b/iu;

export interface PresentedChangelogItem {
  readonly kind: ChangelogItemKind;
  readonly title: string;
  readonly description?: string;
}

export interface PresentedKindGroup {
  readonly kind: ChangelogItemKind;
  readonly heading: string;
  readonly items: readonly PresentedChangelogItem[];
}

export interface PresentedChangelogDay {
  readonly date: string;
  readonly label: string;
  readonly groups: readonly PresentedKindGroup[];
}

export interface PresentedUpdateDigest {
  readonly headline?: string;
  readonly groups: readonly PresentedKindGroup[];
  readonly truncated: boolean;
}

/** Dotted numeric prefix, so `0.0.39-nightly.20260905.1284001654` reads as `0.0.39`. */
export function formatDisplayVersion(version: string): string {
  const trimmed = version.trim().replace(/^v/u, "");
  return trimmed.match(/^(\d+\.\d+\.\d+)/u)?.[1] ?? trimmed;
}

export function formatReleaseDate(isoDate: string, locale?: string): string | null {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(parsed);
}

function formatDateRange(oldestIso: string, newestIso: string, locale?: string): string | null {
  if (oldestIso === newestIso) {
    return formatReleaseDate(newestIso, locale);
  }
  const oldest = new Date(`${oldestIso}T00:00:00Z`);
  const newest = new Date(`${newestIso}T00:00:00Z`);
  if (Number.isNaN(oldest.getTime()) || Number.isNaN(newest.getTime())) {
    return null;
  }
  if (
    oldest.getUTCFullYear() === newest.getUTCFullYear() &&
    oldest.getUTCMonth() === newest.getUTCMonth()
  ) {
    const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      newest,
    );
    return `${month} ${oldest.getUTCDate()}–${newest.getUTCDate()}, ${newest.getUTCFullYear()}`;
  }
  const short = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${short.format(oldest)} – ${short.format(newest)}`;
}

/** One-line subtitle for the post-update dialog: version and when it landed. */
export function formatUpdateSubtitle(
  releases: readonly ChangelogRelease[],
  currentVersion: string,
  locale?: string,
): string {
  const version = formatDisplayVersion(currentVersion);
  const dates = [...new Set(releases.map((release) => release.date))].toSorted();
  const oldest = dates[0];
  const newest = dates.at(-1);
  if (oldest === undefined || newest === undefined) {
    return `Version ${version}`;
  }
  const range = formatDateRange(oldest, newest, locale);
  return range ? `Version ${version} · ${range}` : `Version ${version}`;
}

/** Sentence-case, drop feat-style "add", and strip trailing PR numbers. */
export function formatChangelogTitle(title: string): string {
  const stripped = title.trim().replace(TRAILING_PR, "").replace(LEADING_ADD, "").trim();
  const text = stripped === "" ? title.trim() : stripped;
  if (text === "") {
    return title;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function itemKey(title: string): string {
  return formatChangelogTitle(title).toLowerCase();
}

function isContributorOnlyTitle(title: string): boolean {
  return CONTRIBUTOR_ONLY.test(title);
}

function presentItem(item: ChangelogItem): PresentedChangelogItem {
  const title = formatChangelogTitle(item.title);
  const description = item.description?.trim();
  return description === undefined || description === ""
    ? { kind: item.kind, title }
    : { kind: item.kind, title, description };
}

function dedupeItems(items: readonly ChangelogItem[]): ChangelogItem[] {
  const seen = new Set<string>();
  const unique: ChangelogItem[] = [];
  for (const item of items) {
    const key = itemKey(item.title);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function selectUserFacingItems(items: readonly ChangelogItem[]): ChangelogItem[] {
  const withoutContributor = items.filter((item) => !isContributorOnlyTitle(item.title));
  const pool = withoutContributor.length > 0 ? withoutContributor : [...items];
  const withoutMaintenance = pool.filter((item) => item.title !== MAINTENANCE_ONLY_TITLE);
  return withoutMaintenance.length > 0 ? withoutMaintenance : pool;
}

function groupByKind(items: readonly PresentedChangelogItem[]): PresentedKindGroup[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    heading: KIND_HEADING[kind],
    items: items.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);
}

function limitGroups(
  groups: readonly PresentedKindGroup[],
  limit: number,
): { groups: PresentedKindGroup[]; truncated: boolean } {
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  if (total <= limit) {
    return { groups: [...groups], truncated: false };
  }
  let remaining = limit;
  const limited: PresentedKindGroup[] = [];
  for (const group of groups) {
    if (remaining <= 0) {
      break;
    }
    const items = group.items.slice(0, remaining);
    remaining -= items.length;
    limited.push({ ...group, items });
  }
  return { groups: limited, truncated: true };
}

/** Flatten unseen nightlies into one grouped digest for the update popup. */
export function presentUpdateDigest(releases: readonly ChangelogRelease[]): PresentedUpdateDigest {
  const items = selectUserFacingItems(dedupeItems(releases.flatMap((release) => release.items)));
  const headline = releases[0]?.headline?.trim();
  const { groups, truncated } = limitGroups(
    groupByKind(items.map(presentItem)),
    UPDATE_DIGEST_ITEM_LIMIT,
  );
  return {
    ...(headline ? { headline } : {}),
    groups,
    truncated,
  };
}

/** History view: one section per calendar day, items deduped within the day. */
export function presentChangelogHistory(
  releases: readonly ChangelogRelease[],
  locale?: string,
): PresentedChangelogDay[] {
  const itemsByDate = new Map<string, ChangelogItem[]>();
  const dateOrder: string[] = [];
  for (const release of releases) {
    const existing = itemsByDate.get(release.date);
    if (existing === undefined) {
      itemsByDate.set(release.date, [...release.items]);
      dateOrder.push(release.date);
    } else {
      existing.push(...release.items);
    }
  }

  return dateOrder.flatMap((date) => {
    const items = selectUserFacingItems(dedupeItems(itemsByDate.get(date) ?? []));
    const groups = groupByKind(items.map(presentItem));
    if (groups.length === 0) {
      return [];
    }
    return [
      {
        date,
        label: formatReleaseDate(date, locale) ?? date,
        groups,
      },
    ];
  });
}

export function changelogStaggerIndex(
  groups: readonly PresentedKindGroup[],
  groupIndex: number,
  itemIndex: number,
): number {
  let preceding = 0;
  for (let index = 0; index < groupIndex; index++) {
    preceding += groups[index]?.items.length ?? 0;
  }
  return Math.min(preceding + itemIndex, 5);
}
