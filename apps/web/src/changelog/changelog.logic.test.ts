import { describe, expect, it } from "vite-plus/test";

import {
  advanceLastSeenChangelogVersion,
  compareAppVersions,
  isAnnounceableAppVersion,
  readLastSeenChangelogVersion,
  resolveWhatsNewDecision,
  writeLastSeenChangelogVersion,
} from "./changelog.logic";
import type { ChangelogRelease } from "./changelogData";

function release(version: string): ChangelogRelease {
  return {
    version,
    date: "2026-08-01",
    items: [{ kind: "new", title: `Feature in ${version}` }],
  };
}

const RELEASES = [release("0.0.33"), release("0.0.32"), release("0.0.31")];

describe("compareAppVersions", () => {
  it("compares numeric segments", () => {
    expect(compareAppVersions("0.0.32", "0.0.33")).toBe(-1);
    expect(compareAppVersions("0.0.33", "0.0.32")).toBe(1);
    expect(compareAppVersions("0.0.33", "0.0.33")).toBe(0);
    expect(compareAppVersions("0.1.0", "0.0.99")).toBe(1);
    expect(compareAppVersions("1.0", "1.0.0")).toBe(0);
  });

  it("ignores prerelease suffixes", () => {
    expect(compareAppVersions("0.0.34-nightly.20260810", "0.0.33")).toBe(1);
    expect(compareAppVersions("0.0.34-nightly.1", "0.0.34")).toBe(0);
  });

  it("returns null for unparsable versions", () => {
    expect(compareAppVersions("abc", "0.0.33")).toBeNull();
    expect(compareAppVersions("0.0.33", "")).toBeNull();
  });
});

describe("isAnnounceableAppVersion", () => {
  it("rejects the dev fallback and garbage", () => {
    expect(isAnnounceableAppVersion("0.0.0")).toBe(false);
    expect(isAnnounceableAppVersion("")).toBe(false);
    expect(isAnnounceableAppVersion(null)).toBe(false);
    expect(isAnnounceableAppVersion("not-a-version")).toBe(false);
  });

  it("accepts real versions", () => {
    expect(isAnnounceableAppVersion("0.0.33")).toBe(true);
    expect(isAnnounceableAppVersion("v0.0.34-nightly.1")).toBe(true);
  });
});

describe("advanceLastSeenChangelogVersion", () => {
  it("writes when nothing is stored, advances forward, and never regresses", () => {
    advanceLastSeenChangelogVersion("0.0.33");
    expect(readLastSeenChangelogVersion()).toBe("0.0.33");

    advanceLastSeenChangelogVersion("0.0.32");
    expect(readLastSeenChangelogVersion()).toBe("0.0.33");

    advanceLastSeenChangelogVersion("0.0.34");
    expect(readLastSeenChangelogVersion()).toBe("0.0.34");
  });

  it("ignores non-announceable versions", () => {
    writeLastSeenChangelogVersion("0.0.33");
    advanceLastSeenChangelogVersion("0.0.0");
    expect(readLastSeenChangelogVersion()).toBe("0.0.33");
  });
});

describe("resolveWhatsNewDecision", () => {
  it("stays silent on dev builds", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.0",
      lastSeenVersion: "0.0.31",
      hasExistingInstallData: true,
      releases: RELEASES,
    });
    expect(decision).toEqual({ releases: [], acknowledgeVersion: null });
  });

  it("acknowledges silently on first run", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.33",
      lastSeenVersion: null,
      hasExistingInstallData: false,
      releases: RELEASES,
    });
    expect(decision).toEqual({ releases: [], acknowledgeVersion: "0.0.33" });
  });

  it("catches an existing install up from the rollout baseline", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.33",
      lastSeenVersion: null,
      hasExistingInstallData: true,
      releases: RELEASES,
    });
    expect(decision.acknowledgeVersion).toBeNull();
    expect(decision.releases.map((entry) => entry.version)).toEqual(["0.0.33", "0.0.32", "0.0.31"]);
  });

  it("acknowledges silently for an existing install with no entries to catch up on", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.33",
      lastSeenVersion: null,
      hasExistingInstallData: true,
      releases: [],
    });
    expect(decision).toEqual({ releases: [], acknowledgeVersion: "0.0.33" });
  });

  it("stays silent when the version has not moved", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.33",
      lastSeenVersion: "0.0.33",
      hasExistingInstallData: true,
      releases: RELEASES,
    });
    expect(decision).toEqual({ releases: [], acknowledgeVersion: null });
  });

  it("stays silent on downgrade without regressing the marker", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.32",
      lastSeenVersion: "0.0.33",
      hasExistingInstallData: true,
      releases: RELEASES,
    });
    expect(decision).toEqual({ releases: [], acknowledgeVersion: null });
  });

  it("returns unseen releases newest first after an upgrade", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.33",
      lastSeenVersion: "0.0.31",
      hasExistingInstallData: true,
      releases: [release("0.0.31"), release("0.0.33"), release("0.0.32")],
    });
    expect(decision.acknowledgeVersion).toBeNull();
    expect(decision.releases.map((entry) => entry.version)).toEqual(["0.0.33", "0.0.32"]);
  });

  it("excludes releases newer than the running version", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.32",
      lastSeenVersion: "0.0.31",
      hasExistingInstallData: true,
      releases: RELEASES,
    });
    expect(decision.releases.map((entry) => entry.version)).toEqual(["0.0.32"]);
  });

  it("shows releases up to a nightly's base version", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.34-nightly.20260810",
      lastSeenVersion: "0.0.32",
      hasExistingInstallData: true,
      releases: RELEASES,
    });
    expect(decision.releases.map((entry) => entry.version)).toEqual(["0.0.33"]);
  });

  it("advances the marker silently when an upgrade has no entries", () => {
    const decision = resolveWhatsNewDecision({
      currentVersion: "0.0.40",
      lastSeenVersion: "0.0.33",
      hasExistingInstallData: true,
      releases: RELEASES,
    });
    expect(decision).toEqual({ releases: [], acknowledgeVersion: "0.0.40" });
  });
});
