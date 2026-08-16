import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const scriptPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "resolve-ios-native-build.mjs",
);
const workflowPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../.github/workflows/fork-mobile-release.yml",
);

function run(args, env = {}) {
  return NodeChildProcess.execFileSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "", ...env },
  });
}

describe("T3 Pretty iOS native-build gate", () => {
  it("skips Xcode when a previously submitted local fingerprint still matches", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "local-abc" }),
      "--builds-json",
      JSON.stringify([
        { platform: "IOS", buildProfile: "production", runtimeVersion: "cloud-old" },
      ]),
      "--submitted-fingerprint",
      "local-abc",
    ]);

    assert.include(output, "should_build=false");
    assert.include(output, "submitted_fingerprint=local-abc");
    assert.include(output, "already has a production binary");
  });

  it("rebuilds when both the hosted EAS binary and submitted fingerprint are stale", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "new-hash" }),
      "--builds-json",
      JSON.stringify([
        { platform: "IOS", buildProfile: "production", runtimeVersion: "cloud-old" },
      ]),
      "--submitted-fingerprint",
      "local-old",
    ]);

    assert.include(output, "should_build=true");
    assert.include(output, "local-old -> new-hash");
  });

  it("skips Xcode when the latest production binary already has this fingerprint", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      JSON.stringify([
        {
          platform: "IOS",
          buildProfile: "production",
          status: "finished",
          runtimeVersion: "abc123",
        },
      ]),
    ]);

    assert.include(output, "should_build=false");
    assert.include(output, "already has a production binary");
  });

  it("skips Xcode when an identical production build is still queued or in progress", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      JSON.stringify([
        {
          platform: "IOS",
          buildProfile: "production",
          status: "finished",
          runtimeVersion: "old-hash",
        },
        {
          platform: "IOS",
          buildProfile: "production",
          status: "in-queue",
          runtimeVersion: "abc123",
        },
      ]),
    ]);

    assert.include(output, "should_build=false");
    assert.include(output, "already has an in-queue production build");
  });

  it("rebuilds when only a canceled or errored build matches the fingerprint", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      JSON.stringify([
        {
          platform: "IOS",
          buildProfile: "production",
          status: "errored",
          runtimeVersion: "abc123",
        },
        {
          platform: "IOS",
          buildProfile: "production",
          status: "canceled",
          runtimeVersion: "abc123",
        },
      ]),
    ]);

    assert.include(output, "should_build=true");
    assert.include(output, "none -> abc123");
  });

  it("rebuilds when the native fingerprint changed", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "new-hash" }),
      "--builds-json",
      JSON.stringify([
        {
          platform: "IOS",
          buildProfile: "production",
          status: "finished",
          runtimeVersion: "old-hash",
        },
      ]),
    ]);

    assert.include(output, "should_build=true");
    assert.include(output, "old-hash -> new-hash");
  });

  it("rebuilds when Expo has no finished production iOS binary yet", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      "[]",
    ]);

    assert.include(output, "should_build=true");
    assert.include(output, "none -> abc123");
  });

  it("treats an empty submitted fingerprint as missing instead of the flag true", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      "[]",
      "--submitted-fingerprint",
      "",
    ]);

    assert.match(output, /^submitted_fingerprint=$/mu);
    assert.notInclude(output, "submitted_fingerprint=true");
    assert.include(output, "none -> abc123");
  });

  it("forces a rebuild for explicit build or release mode even when fingerprints match", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      JSON.stringify([{ platform: "IOS", runtimeVersion: "abc123" }]),
      "--force",
      "true",
    ]);

    assert.include(output, "should_build=true");
    assert.include(output, "Forcing a native iOS build");
  });

  it("production release workflow forces a TestFlight IPA", () => {
    const source = NodeFS.readFileSync(workflowPath, "utf8");
    assert.include(source, '"$MODE" == "build" || "$MODE" == "release"');
  });

  it("treats a malformed EAS build list as no previous binary", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      "not-json",
    ]);

    assert.include(output, "should_build=true");
    assert.include(output, "none -> abc123");
  });

  it("reads a raw fingerprint hash from a file", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-fingerprint-"));
    const fingerprintFile = NodePath.join(directory, "fingerprint.json");
    NodeFS.writeFileSync(fingerprintFile, "abc123\n");

    const output = run(["--fingerprint-file", fingerprintFile, "--builds-json", "[]"]);

    assert.include(output, "fingerprint=abc123");
    assert.include(output, "should_build=true");
  });

  it("writes GitHub Actions outputs when asked", () => {
    const outputFile = NodePath.join(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-native-build-")),
      "github-output",
    );

    run(
      [
        "--fingerprint-json",
        JSON.stringify({ hash: "abc123" }),
        "--builds-json",
        "[]",
        "--github-output",
        outputFile,
      ],
      { GITHUB_OUTPUT: "" },
    );

    assert.include(NodeFS.readFileSync(outputFile, "utf8"), "should_build=true\n");
  });
});
