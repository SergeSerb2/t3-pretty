import * as Schema from "effect/Schema";

import type { ChangelogRelease } from "./changelogData";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";

export const CHANGELOG_LAST_SEEN_STORAGE_KEY = "t3code:changelog-last-seen:v1";

/** Marker introduced in 0.0.34. Installs that predate it have no last-seen
    version, so they are treated as having seen everything up to this
    baseline and catch up on the releases after it. */
export const CHANGELOG_ROLLOUT_BASELINE_VERSION = "0.0.30";

const MAINTENANCE_ONLY_TITLE = "Under-the-hood stability and maintenance";

const ChangelogLastSeenSchema = Schema.Struct({
  version: Schema.String,
});

/** Numeric segments of a version, including dotted-numeric prerelease parts
    ("0.0.34-nightly.20260810.1059000052.fork" → [0, 0, 34, 20260810, 1059000052]).
    Alphabetic prerelease identifiers such as "nightly" or "fork" carry no
    ordering information and are skipped. Null when nothing parses. */
function parseVersionSegments(version: string | null | undefined): readonly number[] | null {
  const match = version?.trim().match(/^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) {
    return null;
  }
  const segments = match[1]!.split(".").map(Number);
  const prerelease = match[2];
  if (prerelease) {
    for (const identifier of prerelease.split(".")) {
      if (/^\d+$/u.test(identifier)) {
        segments.push(Number(identifier));
      }
    }
  }
  return segments;
}

/** Compare two app versions by numeric segments, including numeric prerelease
    build numbers so nightly builds order against each other
    ("0.0.34-nightly.20260810.1062" > "0.0.34-nightly.20260810.1059") and a
    plain "0.0.34" sorts below every one of its nightlies. Null when either
    side is unparsable. */
export function compareAppVersions(a: string, b: string): number | null {
  const left = parseVersionSegments(a);
  const right = parseVersionSegments(b);
  if (!left || !right) {
    return null;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftSegment = left[index] ?? 0;
    const rightSegment = right[index] ?? 0;
    if (leftSegment !== rightSegment) {
      return leftSegment < rightSegment ? -1 : 1;
    }
  }
  return 0;
}

/** Whether a version is worth announcing — parsable and not the "0.0.0" dev
    fallback baked into builds without a real version. */
export function isAnnounceableAppVersion(version: string | null | undefined): boolean {
  const segments = parseVersionSegments(version ?? null);
  return segments !== null && segments.some((segment) => segment > 0);
}

export interface WhatsNewDecision {
  /** Releases to present, newest first. Empty means stay silent. */
  readonly releases: readonly ChangelogRelease[];
  /** A version to persist as seen right away (first run, or an update with no
      changelog entries). Null when persistence should wait for dismissal. */
  readonly acknowledgeVersion: string | null;
}

/** Decide what the What's New dialog should do for this launch. Pure so the
    first-run, upgrade, downgrade, and dev-build paths are all testable. */
export function resolveWhatsNewDecision({
  currentVersion,
  lastSeenVersion,
  hasExistingInstallData,
  releases,
}: {
  readonly currentVersion: string;
  readonly lastSeenVersion: string | null;
  /** Whether this browser profile used the app before the marker existed —
      distinguishes an upgrade (catch up from the rollout baseline) from a
      fresh install (stay silent). */
  readonly hasExistingInstallData: boolean;
  readonly releases: readonly ChangelogRelease[];
}): WhatsNewDecision {
  if (!isAnnounceableAppVersion(currentVersion)) {
    return { releases: [], acknowledgeVersion: null };
  }

  // Fresh install: remember where we started instead of replaying history.
  if (lastSeenVersion === null && !hasExistingInstallData) {
    return { releases: [], acknowledgeVersion: currentVersion };
  }

  // Install that predates the marker: catch up from the rollout baseline.
  const effectiveLastSeen = lastSeenVersion ?? CHANGELOG_ROLLOUT_BASELINE_VERSION;

  const movement = compareAppVersions(currentVersion, effectiveLastSeen);
  if (movement === null || movement <= 0) {
    return { releases: [], acknowledgeVersion: null };
  }

  const unseen = omitMaintenanceOnlyReleases(
    releases
      .filter((release) => {
        const aboveLastSeen = compareAppVersions(release.version, effectiveLastSeen);
        const withinCurrent = compareAppVersions(release.version, currentVersion);
        return (
          aboveLastSeen !== null &&
          aboveLastSeen > 0 &&
          withinCurrent !== null &&
          withinCurrent <= 0
        );
      })
      .toSorted((a, b) => -(compareAppVersions(a.version, b.version) ?? 0)),
  );

  if (unseen.length === 0) {
    return { releases: [], acknowledgeVersion: currentVersion };
  }

  return { releases: unseen, acknowledgeVersion: null };
}

function isMaintenanceOnlyRelease(release: ChangelogRelease): boolean {
  return release.items.length === 1 && release.items[0]?.title === MAINTENANCE_ONLY_TITLE;
}

/** Drop stub-only nightly entries when a list also has user-facing notes. */
export function omitMaintenanceOnlyReleases(
  releases: readonly ChangelogRelease[],
): ChangelogRelease[] {
  const visible = releases.filter((release) => !isMaintenanceOnlyRelease(release));
  return visible.length > 0 ? visible : [...releases];
}

/** Whether this browser profile holds app state written before the changelog
    marker existed — any other t3code:* key counts as an existing install. */
export function hasExistingInstallData(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key !== null && key.startsWith("t3code:") && key !== CHANGELOG_LAST_SEEN_STORAGE_KEY) {
        return true;
      }
    }
  } catch (error) {
    console.error("Could not inspect local storage for existing install data.", error);
  }
  return false;
}

export function readLastSeenChangelogVersion(): string | null {
  try {
    return (
      getLocalStorageItem(CHANGELOG_LAST_SEEN_STORAGE_KEY, ChangelogLastSeenSchema)?.version ?? null
    );
  } catch (error) {
    console.error("Could not read the last-seen changelog version.", error);
    return null;
  }
}

export function writeLastSeenChangelogVersion(version: string): void {
  try {
    setLocalStorageItem(CHANGELOG_LAST_SEEN_STORAGE_KEY, { version }, ChangelogLastSeenSchema);
  } catch (error) {
    console.error("Could not persist the last-seen changelog version.", error);
  }
}

/** Persist a version as seen only when it moves the marker forward, so a
    downgraded client can never mark an already-seen release as unseen. */
export function advanceLastSeenChangelogVersion(version: string): void {
  if (!isAnnounceableAppVersion(version)) {
    return;
  }
  const stored = readLastSeenChangelogVersion();
  if (stored !== null && (compareAppVersions(version, stored) ?? 0) <= 0) {
    return;
  }
  writeLastSeenChangelogVersion(version);
}
