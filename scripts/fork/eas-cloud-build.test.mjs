import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  classifyCloudBuildStatus,
  DEFAULT_EAS_WAIT_SECONDS,
  formatInflightRecord,
  inflightAsBuild,
  inflightMatchesFingerprint,
  isBuildId,
  parseInflightRecord,
  pickCloudBuild,
  runCli,
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
  });

  it("classifies Expo statuses and refuses to hide a real compile failure", () => {
    assert.equal(classifyCloudBuildStatus("IN_PROGRESS"), "active");
    assert.equal(classifyCloudBuildStatus("in-queue"), "active");
    assert.equal(classifyCloudBuildStatus("NEW"), "active");
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
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
