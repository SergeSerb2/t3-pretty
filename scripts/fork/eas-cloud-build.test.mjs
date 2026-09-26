import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  archiveUrlFor,
  classifyCloudBuildStatus,
  DEFAULT_EAS_VIEW_FAIL_POLLS,
  DEFAULT_EAS_WAIT_SECONDS,
  EXPO_GRAPHQL_URL,
  fetchCloudBuildById,
  fetchCloudBuildsViaGraphql,
  fingerprintOf,
  isListedProductionStoreBuild,
  isStoreDistribution,
  STORE_IOS_BUILD_FILTER,
  formatCloudBuildState,
  formatInflightRecord,
  inflightAsBuild,
  inflightMatchesFingerprint,
  isBuildId,
  isStaleStatusRefresh,
  parseInflightRecord,
  pickCloudBuild,
  runCli,
  viewCloudBuildViaEas,
  waitOutcome,
} from "./eas-cloud-build.mjs";

const helper = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "eas-cloud-build.mjs",
);

const BUILD_ID = "9312795f-d30f-4cc8-a20b-aea2931a4232";

function run(args) {
  return NodeChildProcess.execFileSync(NodeProcess.execPath, [helper, ...args], {
    encoding: "utf8",
  });
}

describe("EAS cloud IPA wait / reuse helpers", () => {
  it("defaults the wait budget to an IPA-length Expo compile bound", () => {
    // Two minutes was the agent-loss probe. A live windows-release agent
    // must stay attached through a typical 20–45 minute cloud IPA.
    assert.equal(DEFAULT_EAS_WAIT_SECONDS, 3600);
    assert.isAtLeast(DEFAULT_EAS_WAIT_SECONDS, 1800);
    assert.equal(DEFAULT_EAS_VIEW_FAIL_POLLS, 6);
    assert.isBelow(DEFAULT_EAS_VIEW_FAIL_POLLS * 20, 600);
  });

  it("classifies Expo statuses and refuses to hide a real compile failure", () => {
    assert.equal(classifyCloudBuildStatus("IN_PROGRESS"), "active");
    assert.equal(classifyCloudBuildStatus("in-queue"), "active");
    assert.equal(classifyCloudBuildStatus("NEW"), "active");
    assert.equal(classifyCloudBuildStatus("PENDING_CANCEL"), "active");
    assert.equal(classifyCloudBuildStatus("FINISHED"), "finished");
    assert.equal(classifyCloudBuildStatus("ERRORED"), "failed");
    assert.equal(classifyCloudBuildStatus("canceled"), "failed");
    assert.equal(classifyCloudBuildStatus(""), "unknown");

    assert.equal(waitOutcome({ kind: "failed", interrupted: true, timedOut: true }), "fail");
    assert.equal(waitOutcome({ kind: "finished", interrupted: true }), "continue");
    assert.equal(waitOutcome({ kind: "active", interrupted: true }), "soft-exit");
    assert.equal(waitOutcome({ kind: "active", timedOut: true }), "soft-exit");
    assert.equal(waitOutcome({ kind: "unknown", timedOut: true }), "soft-exit");
    assert.equal(waitOutcome({ kind: "active" }), "poll");
    assert.equal(
      waitOutcome({ kind: "unknown", viewFailures: 6, maxViewFailures: 6 }),
      "soft-exit",
    );
    assert.equal(
      waitOutcome({ kind: "active", viewFailures: 5, maxViewFailures: 6 }),
      "poll",
    );
    assert.equal(
      waitOutcome({ kind: "failed", viewFailures: 6, maxViewFailures: 6 }),
      "fail",
    );
    assert.equal(
      waitOutcome({ kind: "finished", viewFailures: 6, maxViewFailures: 6 }),
      "continue",
    );
    assert.isTrue(isStaleStatusRefresh({ viewFailures: 6, maxViewFailures: 6 }));
    assert.isFalse(isStaleStatusRefresh({ viewFailures: 1, maxViewFailures: 6 }));
    assert.isFalse(isStaleStatusRefresh({ viewFailures: 6, maxViewFailures: 0 }));
  });

  it("reads a submitted --no-wait build id before an archive exists", () => {
    const raw = [
      "progress {not valid JSON around the later values:",
      JSON.stringify({
        status: "IN_QUEUE",
        progress: { message: "Waiting for a worker" },
      }),
      JSON.stringify({
        id: BUILD_ID,
        status: "IN_PROGRESS",
        appBuildVersion: "173",
        runtimeVersion: "abc123",
      }),
      "}",
    ].join("\n");
    const build = pickCloudBuild(raw);
    assert.equal(build.id, BUILD_ID);
    assert.equal(build.status, "IN_PROGRESS");
    assert.equal(build.appBuildVersion, "173");
    assert.equal(pickCloudBuild(raw, { requireArchive: true }), null);
  });

  it("persists and reloads an in-flight EAS id for the same fingerprint", () => {
    const record = parseInflightRecord(
      formatInflightRecord({
        id: BUILD_ID,
        fingerprint: "abc123",
        commit: "1a8ceaddec412a8dea57cb08cef38fbc8ef66270",
        buildNumber: "173",
        status: "in-progress",
      }),
    );
    assert.equal(record.id, BUILD_ID);
    assert.equal(record.fingerprint, "abc123");
    assert.equal(record.buildNumber, "173");
    assert.isTrue(inflightMatchesFingerprint(record, "abc123"));
    assert.isFalse(inflightMatchesFingerprint(record, "other"));
    assert.equal(inflightAsBuild(record).runtimeVersion, "abc123");
    assert.equal(inflightAsBuild(record).status, "in-progress");
    assert.isTrue(isBuildId(BUILD_ID));
    assert.isFalse(isBuildId("not-a-uuid"));
    assert.throws(() => parseInflightRecord("status=in-progress\n"), /missing a build id/u);
  });

  it("exposes read/write/wait-outcome on the CLI", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-eas-inflight-"));
    const inflight = NodePath.join(directory, "ios-eas-inflight");
    const json = NodePath.join(directory, "build.json");
    try {
      NodeFS.writeFileSync(
        json,
        `${JSON.stringify({
          id: BUILD_ID,
          status: "IN_QUEUE",
          metadata: { appBuildVersion: "173", fingerprintHash: "fp-1" },
        })}\n`,
      );
      const state = run(["--read-json", json]);
      assert.include(state, `id=${BUILD_ID}`);
      assert.include(state, "kind=active");
      assert.include(state, "build_number=173");
      assert.include(state, "fingerprint=fp-1");

      run([
        "--write-inflight",
        inflight,
        "--id",
        BUILD_ID,
        "--fingerprint",
        "fp-1",
        "--commit",
        "abc",
        "--build-number",
        "173",
        "--status",
        "in-progress",
      ]);
      assert.include(NodeFS.readFileSync(inflight, "utf8"), `id=${BUILD_ID}`);
      assert.include(NodeFS.readFileSync(inflight, "utf8"), "buildNumber=173");
      assert.include(run(["--read-inflight", inflight]), "fingerprint=fp-1");
      assert.equal(
        run(["--wait-outcome", "--kind", "active", "--interrupted", "true"]).trim(),
        "soft-exit",
      );
      assert.equal(
        run(["--wait-outcome", "--kind", "failed", "--timed-out", "true"]).trim(),
        "fail",
      );
      assert.equal(runCli(["--wait-outcome", "--kind", "finished"]).trim(), "continue");
      assert.equal(
        run([
          "--wait-outcome",
          "--kind",
          "unknown",
          "--view-failures",
          "6",
          "--max-view-failures",
          "6",
        ]).trim(),
        "soft-exit",
      );
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reads FINISHED status and the archive URL from Expo GraphQL", async () => {
    const artifact = "https://expo.invalid/application.ipa";
    const build = await fetchCloudBuildById({
      buildId: BUILD_ID,
      token: "test-token",
      fetchImpl: async (url, init) => {
        assert.equal(url, EXPO_GRAPHQL_URL);
        const body = JSON.parse(init.body);
        assert.equal(body.variables.buildId, BUILD_ID);
        assert.equal(init.headers.Authorization, "Bearer test-token");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              builds: {
                byId: {
                  id: BUILD_ID,
                  status: "FINISHED",
                  appBuildVersion: "173",
                  artifacts: { applicationArchiveUrl: artifact },
                  runtime: { version: "abc123" },
                  fingerprint: { hash: "abc123" },
                },
              },
            },
          }),
        };
      },
    });
    assert.equal(classifyCloudBuildStatus(build.status), "finished");
    assert.equal(archiveUrlFor(build), artifact);
    assert.equal(fingerprintOf(build), "abc123");
    assert.include(formatCloudBuildState(build), "kind=finished");
    assert.include(formatCloudBuildState(build), `artifact_url=${artifact}`);
  });

  it("lists store production iOS builds from Expo GraphQL and skips other profiles", async () => {
    let sentFilter;
    const builds = await fetchCloudBuildsViaGraphql({
      token: "test-token",
      appId: "1eb51d67-48c5-4100-8aa8-f5ac9e1ada65",
      fetchImpl: async (_url, init) => {
        sentFilter = JSON.parse(init.body).variables.filter;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              app: {
                byId: {
                  builds: [
                    {
                      id: BUILD_ID,
                      status: "IN_PROGRESS",
                      platform: "IOS",
                      buildProfile: "production",
                      distribution: "STORE",
                      runtime: { version: "abc123" },
                    },
                    {
                      id: "347c6b49-e7dd-4c26-b221-efe6761a8222",
                      status: "FINISHED",
                      platform: "IOS",
                      buildProfile: "preview",
                      distribution: "STORE",
                      runtime: { version: "abc123" },
                    },
                    {
                      id: "9f1e2d3c-4b5a-6789-abcd-ef0123456789",
                      status: "FINISHED",
                      platform: "IOS",
                      buildProfile: "production",
                      distribution: "INTERNAL",
                      runtime: { version: "abc123" },
                    },
                    {
                      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                      status: "FINISHED",
                      platform: "IOS",
                      buildProfile: "production",
                      distribution: "SIMULATOR",
                      runtime: { version: "abc123" },
                    },
                  ],
                },
              },
            },
          }),
        };
      },
    });
    assert.deepEqual(sentFilter, STORE_IOS_BUILD_FILTER);
    assert.equal(sentFilter.distribution, "STORE");
    assert.equal(builds.length, 1);
    assert.equal(builds[0]?.id, BUILD_ID);
    assert.equal(classifyCloudBuildStatus(builds[0]?.status), "active");
    assert.isTrue(isStoreDistribution({ distribution: "STORE" }));
    assert.isTrue(isStoreDistribution({}));
    assert.isFalse(isStoreDistribution({ distribution: "internal" }));
    assert.isFalse(isListedProductionStoreBuild({ id: BUILD_ID, distribution: "SIMULATOR" }));
  });

  it("calls eas build:view --json without --non-interactive", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-eas-view-"));
    const easBin = NodePath.join(directory, "eas");
    const argvFile = NodePath.join(directory, "argv.json");
    try {
      NodeFS.writeFileSync(
        easBin,
        [
          "#!/usr/bin/env node",
          'const fs = require("node:fs");',
          "fs.writeFileSync(process.env.EAS_ARGV, JSON.stringify(process.argv.slice(2)));",
          "process.stdout.write(JSON.stringify({",
          "  id: process.argv[3],",
          '  status: "IN_PROGRESS",',
          "}));",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const build = viewCloudBuildViaEas(BUILD_ID, {
        env: { ...NodeProcess.env, EAS_BIN: easBin, EAS_ARGV: argvFile },
      });
      const argv = JSON.parse(NodeFS.readFileSync(argvFile, "utf8"));
      assert.deepEqual(argv, ["build:view", BUILD_ID, "--json"]);
      assert.notInclude(argv, "--non-interactive");
      assert.equal(build.id, BUILD_ID);
      assert.equal(classifyCloudBuildStatus(build.status), "active");
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
