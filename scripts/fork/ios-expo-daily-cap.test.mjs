import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  DEFAULT_TIMEZONE,
  collectIosUpdateGroups,
  evaluateDailyCap,
  formatCapReport,
  includesIosPlatform,
  parseLimit,
  vancouverDay,
} from "./ios-expo-daily-cap.mjs";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const helper = NodePath.resolve(here, "ios-expo-daily-cap.mjs");

function runCli(args, { env = {} } = {}) {
  return NodeChildProcess.spawnSync(NodeProcess.execPath, [helper, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("iOS Expo daily cap", () => {
  it("uses America/Vancouver calendar days, including the PDT boundary", () => {
    assert.equal(DEFAULT_TIMEZONE, "America/Vancouver");
    assert.equal(parseLimit(undefined), 2);
    assert.equal(parseLimit("0"), 0);
    // 2026-09-24 06:59 UTC is still the 23rd in Vancouver (UTC-7).
    assert.equal(vancouverDay("2026-09-24T06:59:59.000Z"), "2026-09-23");
    assert.equal(vancouverDay("2026-09-24T07:00:00.000Z"), "2026-09-24");
  });

  it("counts production iOS EAS builds and iOS update groups toward the same budget", () => {
    const day = "2026-09-24T16:00:00.000Z";
    const result = evaluateDailyCap({
      now: day,
      builds: [
        { id: "build-today", platform: "IOS", createdAt: "2026-09-24T15:00:00.000Z" },
        { id: "build-yesterday", platform: "ios", createdAt: "2026-09-23T16:00:00.000Z" },
        { id: "build-android", platform: "ANDROID", createdAt: "2026-09-24T15:30:00.000Z" },
      ],
      updates: [
        {
          group: "ota-today",
          platform: "ios",
          createdAt: "2026-09-24T18:00:00.000Z",
        },
        {
          group: "ota-today",
          platform: "android",
          createdAt: "2026-09-24T18:00:00.000Z",
        },
        {
          group: "ota-android-only",
          platform: "android",
          createdAt: "2026-09-24T19:00:00.000Z",
        },
      ],
    });

    assert.equal(result.status, "ok");
    assert.equal(result.day, "2026-09-24");
    assert.equal(result.builds, 1);
    assert.equal(result.updates, 1);
    assert.equal(result.used, 2);
    assert.equal(result.remaining, 0);
    assert.equal(result.allowed, false);
    assert.include(formatCapReport(result), "store=fixture");
  });

  it("treats a --platform all update group as one iOS slot", () => {
    const groups = collectIosUpdateGroups([
      { group: "all-platforms", platforms: "android, ios", createdAt: "2026-09-24T12:00:00.000Z" },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.id, "all-platforms");
    assert.isTrue(includesIosPlatform({ platforms: "all" }));
  });

  it("does not count records without a parseable createdAt", () => {
    const result = evaluateDailyCap({
      now: "2026-09-24T16:00:00.000Z",
      builds: [{ id: "no-date", platform: "ios" }],
      updates: [
        { group: "relative-only", platform: "ios", message: "Production OTA (2 hours ago)" },
      ],
    });
    assert.equal(result.used, 0);
    assert.equal(result.allowed, true);
  });

  it("disables the cap when the limit is 0", () => {
    const result = evaluateDailyCap({
      now: "2026-09-24T16:00:00.000Z",
      limit: 0,
      builds: [{ id: "build-today", platform: "IOS", createdAt: "2026-09-24T15:00:00.000Z" }],
    });
    assert.equal(result.status, "disabled");
    assert.equal(result.allowed, true);
    assert.equal(result.used, 0);
  });

  it("prints a durable Expo-backed report from fixture files", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-expo-cap-"));
    try {
      const builds = NodePath.join(root, "builds.json");
      const updates = NodePath.join(root, "updates.json");
      NodeFS.writeFileSync(
        builds,
        `${JSON.stringify([
          {
            id: "467e7759-a0d5-47d6-a8b5-9be5a14f3aa4",
            platform: "IOS",
            createdAt: "2026-09-24T08:10:00.000Z",
          },
        ])}\n`,
      );
      NodeFS.writeFileSync(
        updates,
        `${JSON.stringify({
          currentPage: [
            {
              group: "03d5dfcf-736c-475a-8730-af039c3f4d06",
              platform: "ios",
              createdAt: "2026-09-24T09:00:00.000Z",
            },
          ],
        })}\n`,
      );
      const ran = runCli([
        "--builds-file",
        builds,
        "--updates-file",
        updates,
        "--now",
        "2026-09-24T16:00:00.000Z",
        "--timezone",
        "America/Vancouver",
        "--limit",
        "2",
      ]);
      assert.equal(ran.status, 0, ran.stderr);
      assert.include(ran.stdout, "day=2026-09-24");
      assert.include(ran.stdout, "used=2");
      assert.include(ran.stdout, "remaining=0");
      assert.include(ran.stdout, "allowed=false");
      assert.include(ran.stdout, "status=ok");
      assert.include(ran.stdout, "store=fixture");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
