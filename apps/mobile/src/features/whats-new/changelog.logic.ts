/**
 * Pure What's New decision logic, shared in spirit with
 * apps/web/src/changelog/changelog.logic.ts — keep the semantics in step when
 * changing either. Persistence lives with the caller (mobile preferences),
 * unlike the web module's localStorage helpers.
 */
import type { ChangelogRelease } from "./changelogData";

/** Marker baseline: installs that predate the last-seen marker catch up on
    releases after this version instead of replaying all history. */
export const CHANGELOG_ROLLOUT_BASELINE_VERSION = "0.0.33";

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
  hasExistingInstallData,
  releases,
}: {
  readonly currentVersion: string;
  readonly lastSeenVersion: string | null;
  /** Whether this device used the app before the marker existed —
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

  const unseen = releases
    .filter((release) => {
      const aboveLastSeen = compareAppVersions(release.version, effectiveLastSeen);
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
