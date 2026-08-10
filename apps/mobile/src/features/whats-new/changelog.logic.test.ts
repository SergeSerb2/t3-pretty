import { describe, expect, it } from "vite-plus/test";

import {
  compareAppVersions,
  isAnnounceableAppVersion,
  resolveWhatsNewDecision,
} from "./changelog.logic";
import type { ChangelogRelease } from "./changelogData";

const releases: readonly ChangelogRelease[] = [
  { version: "0.0.34", date: "2026-08-10", items: [{ kind: "new", title: "Scenery" }] },
  { version: "0.0.33", date: "2026-08-01", items: [{ kind: "fixed", title: "Bug" }] },
];

describe("compareAppVersions", () => {
  it("orders numeric segments and ignores prerelease suffixes", () => {
    expect(compareAppVersions("0.0.34", "0.0.33")).toBe(1);
    expect(compareAppVersions("0.0.34-nightly.1", "0.0.34")).toBe(0);
    expect(compareAppVersions("0.0.9", "0.0.34")).toBe(-1);
    expect(compareAppVersions("junk", "0.0.34")).toBeNull();
  });
});

describe("isAnnounceableAppVersion", () => {
  it("rejects dev fallbacks and unparsable versions", () => {
    expect(isAnnounceableAppVersion("0.0.0")).toBe(false);
    expect(isAnnounceableAppVersion(null)).toBe(false);
    expect(isAnnounceableAppVersion("0.0.34")).toBe(true);
  });
});

describe("resolveWhatsNewDecision", () => {
  it("stays silent and acknowledges on a fresh install", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.34",
      lastSeenVersion: null,
      hasExistingInstallData: false,
      releases,
    });
    expect(decision.releases).toHaveLength(0);
    expect(decision.acknowledgeVersion).toBe("0.0.34");
  });

  it("shows unseen releases after an upgrade, newest first", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.34",
      lastSeenVersion: "0.0.32",
      hasExistingInstallData: true,
      releases,
    });
    expect(decision.releases.map((release) => release.version)).toEqual(["0.0.34", "0.0.33"]);
    expect(decision.acknowledgeVersion).toBeNull();
  });

  it("catches up from the rollout baseline for pre-marker installs", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.34",
      lastSeenVersion: null,
      hasExistingInstallData: true,
      releases,
    });
    expect(decision.releases.map((release) => release.version)).toEqual(["0.0.34"]);
  });

  it("stays silent on downgrades and dev builds", () => {
    expect(
      resolveWhatsNewDecision({
        currentVersion: "0.0.31",
        lastSeenVersion: "0.0.34",
        hasExistingInstallData: true,
        releases,
      }).releases,
    ).toHaveLength(0);
    expect(
      resolveWhatsNewDecision({
        currentVersion: "0.0.0",
        lastSeenVersion: "0.0.33",
        hasExistingInstallData: true,
        releases,
      }),
    ).toEqual({ releases: [], acknowledgeVersion: null });
  });

  it("acknowledges silently when an update carries no changelog entries", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.35",
      lastSeenVersion: "0.0.34",
      hasExistingInstallData: true,
      releases: [],
    });
    expect(decision.releases).toHaveLength(0);
    expect(decision.acknowledgeVersion).toBe("0.0.35");
  });
});
