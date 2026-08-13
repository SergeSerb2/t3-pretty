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
      JSON.stringify([{ platform: "IOS", buildProfile: "production", runtimeVersion: "abc123" }]),
    ]);

    assert.include(output, "should_build=false");
    assert.include(output, "already has a production binary");
  });

  it("rebuilds when the native fingerprint changed", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "new-hash" }),
      "--builds-json",
      JSON.stringify([{ platform: "IOS", buildProfile: "production", runtimeVersion: "old-hash" }]),
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

  it("forces a rebuild for explicit build mode even when fingerprints match", () => {
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
