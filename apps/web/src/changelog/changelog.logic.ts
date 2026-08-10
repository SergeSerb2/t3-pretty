import * as Schema from "effect/Schema";

import type { ChangelogRelease } from "./changelogData";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";

export const CHANGELOG_LAST_SEEN_STORAGE_KEY = "t3code:changelog-last-seen:v1";

const ChangelogLastSeenSchema = Schema.Struct({
  version: Schema.String,
});

/** Numeric dotted prefix of a version, ignoring any prerelease suffix
    ("0.0.34-nightly.1" → [0, 0, 34]). Null when nothing parses. */
function parseVersionSegments(version: string | null | undefined): readonly number[] | null {
  const match = version?.trim().match(/^v?(\d+(?:\.\d+)*)/);
  if (!match) {
    return null;
  }
  return match[1]!.split(".").map(Number);
}

/** Compare two app versions by numeric segments. Prerelease suffixes are
    ignored, so "0.0.34-nightly" and "0.0.34" compare equal. Null when either
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
  releases,
}: {
  readonly currentVersion: string;
  readonly lastSeenVersion: string | null;
  readonly releases: readonly ChangelogRelease[];
}): WhatsNewDecision {
  if (!isAnnounceableAppVersion(currentVersion)) {
    return { releases: [], acknowledgeVersion: null };
  }

  // First run: remember where we started instead of replaying history.
  if (lastSeenVersion === null) {
    return { releases: [], acknowledgeVersion: currentVersion };
  }

  const movement = compareAppVersions(currentVersion, lastSeenVersion);
  if (movement === null || movement <= 0) {
    return { releases: [], acknowledgeVersion: null };
  }

  const unseen = releases
    .filter((release) => {
      const aboveLastSeen = compareAppVersions(release.version, lastSeenVersion);
      const withinCurrent = compareAppVersions(release.version, currentVersion);
      return (
        aboveLastSeen !== null && aboveLastSeen > 0 && withinCurrent !== null && withinCurrent <= 0
      );
    })
    .toSorted((a, b) => -(compareAppVersions(a.version, b.version) ?? 0));

  if (unseen.length === 0) {
    return { releases: [], acknowledgeVersion: currentVersion };
  }

  return { releases: unseen, acknowledgeVersion: null };
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
