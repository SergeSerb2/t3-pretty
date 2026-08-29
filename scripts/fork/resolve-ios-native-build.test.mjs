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
const mobileReleasePath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "publish-mobile-release.sh",
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

  it("does not treat a finished hosted build as TestFlight delivery", () => {
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

    assert.include(output, "should_build=true");
    assert.include(output, "none -> abc123");
  });

  it("does not let an in-flight hosted build suppress the local submit path", () => {
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

    assert.include(output, "should_build=true");
    assert.include(output, "none -> abc123");
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

  it("reads a full eas fingerprint:generate --json dump larger than 64 KiB", () => {
    // The real dump lists every hashed native source and runs past 64 KiB;
    // a 64 KiB cap failed every TestFlight job with "exceeded the safety limit".
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fingerprint-"));
    const file = NodePath.join(dir, "ios-fingerprint.json");
    const sources = Array.from({ length: 2000 }, (_, index) => ({
      type: "file",
      filePath: `ios/Sources/Generated/File${index}.swift`,
      hash: "0123456789abcdef0123456789abcdef01234567",
      reasons: ["expoAutolinkingIos"],
    }));
    NodeFS.writeFileSync(file, JSON.stringify({ hash: "big-dump-hash", sources }));
    assert.isAbove(NodeFS.statSync(file).size, 64 * 1024);
    const output = run(["--fingerprint-file", file, "--submitted-fingerprint", "big-dump-hash"]);
    assert.include(output, "fingerprint=big-dump-hash");
    assert.include(output, "should_build=false");
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
    assert.include(output, "none -> new-hash");
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

  it("labels the shared gate correctly for Android releases", () => {
    const output = run([
      "--platform",
      "android",
      "--fingerprint-json",
      JSON.stringify({ hash: "android-new" }),
      "--submitted-fingerprint",
      "android-old",
    ]);

    assert.include(output, "should_build=true");
    assert.include(output, "Android runtime fingerprint changed (android-old -> android-new)");
    assert.notInclude(output, "iOS runtime fingerprint");
  });

  it("automatic release skips Xcode when the fingerprint is unchanged", () => {
    const source = NodeFS.readFileSync(mobileReleasePath, "utf8");
    assert.include(source, '"$MODE" == "build" || "$FORCE_IOS" == "true"');
    assert.notInclude(source, '"$MODE" == "build" || "$MODE" == "release"');
    assert.include(source, "Native fingerprint is unchanged");
    assert.include(source, "ipa_via_cloud");
    assert.include(source, "Submitted TestFlight IPA via EAS cloud");
    assert.include(source, "/Applications/Xcode-beta.app");
    assert.notInclude(source, "Skipping a new IPA");
    assert.notInclude(source, "xcode_is_store_supported");
    assert.notInclude(source, "No native macos-release TestFlight submit recorded");
    assert.include(source, ".t3-fork/ios-native-submit");
  });

  it("ignores malformed hosted build metadata because it is not delivery proof", () => {
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

  it("bounds the submitted-fingerprint marker before loading it into an argument", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-submitted-"));
    const submittedFile = NodePath.join(directory, "ios-production-fingerprint");
    NodeFS.writeFileSync(submittedFile, "abc123\n");

    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--submitted-fingerprint-file",
      submittedFile,
    ]);
    assert.include(output, "should_build=false");

    NodeFS.writeFileSync(submittedFile, "x".repeat(64 * 1024 + 1));
    assert.throws(
      () =>
        run([
          "--fingerprint-json",
          JSON.stringify({ hash: "abc123" }),
          "--submitted-fingerprint-file",
          submittedFile,
        ]),
      /safety limit/u,
    );

    const source = NodeFS.readFileSync(mobileReleasePath, "utf8");
    assert.include(source, '--submitted-fingerprint-file "$submitted_fingerprint_file"');
    assert.notInclude(source, 'submitted_fingerprint="$(tr -d');
  });

  it("rejects fingerprint output injection and oversized files", () => {
    assert.throws(
      () =>
        run([
          "--fingerprint-json",
          JSON.stringify({ hash: "abc123\nshould_build=false" }),
          "--builds-json",
          "[]",
        ]),
      /control character/u,
    );

    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-fingerprint-"));
    const fingerprintFile = NodePath.join(directory, "fingerprint.json");
    NodeFS.writeFileSync(fingerprintFile, "x".repeat(16 * 1024 * 1024 + 1));
    assert.throws(
      () => run(["--fingerprint-file", fingerprintFile, "--builds-json", "[]"]),
      /safety limit/u,
    );
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
