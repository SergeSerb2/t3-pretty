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
    assert.match(output, /^reuse_build_id=$/mu);
    assert.match(output, /^reuse_artifact_url=$/mu);
    assert.match(output, /^reuse_status=$/mu);
  });

  it("reuses a finished matching cloud IPA without treating it as already submitted", () => {
    const artifact = "https://expo.invalid/application.ipa?token=1&x=2";
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "5cc2e910d76aeb407d0e90c7509726039bcfe167" }),
      "--builds-json",
      JSON.stringify([
        {
          id: "347c6b49-e7dd-4c26-b221-efe6761a8222",
          platform: "IOS",
          buildProfile: "production",
          status: "FINISHED",
          runtimeVersion: "5cc2e910d76aeb407d0e90c7509726039bcfe167",
          artifacts: { applicationArchiveUrl: artifact },
        },
      ]),
    ]);

    assert.include(output, "should_build=true");
    assert.include(output, "reuse_build_id=347c6b49-e7dd-4c26-b221-efe6761a8222");
    assert.include(output, `reuse_artifact_url=${artifact}`);
    assert.include(output, "reuse_status=finished");
    assert.include(output, "Reusing finished EAS cloud IPA 347c6b49-e7dd-4c26-b221-efe6761a8222");
    assert.notInclude(output, "already has a production binary");
  });

  it("does not reuse a finished IPA when the submitted fingerprint already matches", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      JSON.stringify([
        {
          id: "already-submitted",
          platform: "IOS",
          buildProfile: "production",
          status: "finished",
          runtimeVersion: "abc123",
          artifacts: { applicationArchiveUrl: "https://expo.invalid/old.ipa" },
        },
      ]),
      "--submitted-fingerprint",
      "abc123",
    ]);

    assert.include(output, "should_build=false");
    assert.match(output, /^reuse_build_id=$/mu);
    assert.match(output, /^reuse_artifact_url=$/mu);
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
    assert.match(output, /^reuse_build_id=$/mu);
    assert.notInclude(output, "already has a production binary");
  });

  it("reattaches to an in-flight matching cloud IPA without treating it as submitted", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      JSON.stringify([
        {
          id: "9312795f-d30f-4cc8-a20b-aea2931a4232",
          platform: "IOS",
          buildProfile: "production",
          status: "IN_PROGRESS",
          runtimeVersion: "abc123",
        },
      ]),
    ]);

    assert.include(output, "should_build=true");
    assert.include(output, "reuse_build_id=9312795f-d30f-4cc8-a20b-aea2931a4232");
    assert.include(output, "reuse_status=active");
    assert.match(output, /^reuse_artifact_url=$/mu);
    assert.include(
      output,
      "Reattaching to in-flight EAS cloud IPA 9312795f-d30f-4cc8-a20b-aea2931a4232",
    );
    assert.notInclude(output, "already has a production binary");
  });

  it("prefers a finished matching IPA over an in-flight persist record", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-inflight-"));
    const inflight = NodePath.join(directory, "ios-eas-inflight");
    const artifact = "https://expo.invalid/application.ipa";
    try {
      NodeFS.writeFileSync(
        inflight,
        [
          "id=9312795f-d30f-4cc8-a20b-aea2931a4232",
          "fingerprint=abc123",
          "commit=1a8ceaddec412a8dea57cb08cef38fbc8ef66270",
          "buildNumber=173",
          "status=in-progress",
          "",
        ].join("\n"),
      );
      const output = run([
        "--fingerprint-json",
        JSON.stringify({ hash: "abc123" }),
        "--inflight-file",
        inflight,
        "--builds-json",
        JSON.stringify([
          {
            id: "347c6b49-e7dd-4c26-b221-efe6761a8222",
            platform: "IOS",
            buildProfile: "production",
            status: "finished",
            runtimeVersion: "abc123",
            artifacts: { applicationArchiveUrl: artifact },
          },
        ]),
      ]);
      assert.include(output, "reuse_build_id=347c6b49-e7dd-4c26-b221-efe6761a8222");
      assert.include(output, "reuse_status=finished");
      assert.include(output, `reuse_artifact_url=${artifact}`);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reattaches from a persisted id whose recorded status is unknown", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-inflight-"));
    const inflight = NodePath.join(directory, "ios-eas-inflight");
    try {
      NodeFS.writeFileSync(
        inflight,
        [
          "id=9312795f-d30f-4cc8-a20b-aea2931a4232",
          "fingerprint=abc123",
          "buildNumber=173",
          "status=PENDING_WORKER",
          "",
        ].join("\n"),
      );
      const output = run([
        "--fingerprint-json",
        JSON.stringify({ hash: "abc123" }),
        "--inflight-file",
        inflight,
        "--builds-json",
        "[]",
      ]);
      assert.include(output, "should_build=true");
      assert.include(output, "reuse_build_id=9312795f-d30f-4cc8-a20b-aea2931a4232");
      assert.include(output, "reuse_status=active");
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reattaches from a persisted in-flight id when Expo's list is empty", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-inflight-"));
    const inflight = NodePath.join(directory, "ios-eas-inflight");
    try {
      NodeFS.writeFileSync(
        inflight,
        [
          "id=9312795f-d30f-4cc8-a20b-aea2931a4232",
          "fingerprint=abc123",
          "buildNumber=173",
          "status=in-progress",
          "",
        ].join("\n"),
      );
      const output = run([
        "--fingerprint-json",
        JSON.stringify({ hash: "abc123" }),
        "--inflight-file",
        inflight,
        "--builds-json",
        "[]",
      ]);
      assert.include(output, "should_build=true");
      assert.include(output, "reuse_build_id=9312795f-d30f-4cc8-a20b-aea2931a4232");
      assert.include(output, "reuse_status=active");
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("ignores a persisted in-flight id for a different fingerprint", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-inflight-"));
    const inflight = NodePath.join(directory, "ios-eas-inflight");
    try {
      NodeFS.writeFileSync(
        inflight,
        [
          "id=9312795f-d30f-4cc8-a20b-aea2931a4232",
          "fingerprint=old-hash",
          "status=in-progress",
          "",
        ].join("\n"),
      );
      const output = run([
        "--fingerprint-json",
        JSON.stringify({ hash: "abc123" }),
        "--inflight-file",
        inflight,
        "--builds-json",
        "[]",
      ]);
      assert.match(output, /^reuse_build_id=$/mu);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rebuilds when only a canceled or errored build matches the fingerprint", () => {
    const output = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      JSON.stringify([
        {
          id: "11111111-1111-4111-8111-111111111111",
          platform: "IOS",
          buildProfile: "production",
          status: "errored",
          runtimeVersion: "abc123",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          platform: "IOS",
          buildProfile: "production",
          status: "canceled",
          runtimeVersion: "abc123",
        },
      ]),
    ]);

    assert.include(output, "should_build=true");
    assert.include(output, "none -> abc123");
    assert.match(output, /^reuse_build_id=$/mu);
    assert.match(output, /^reuse_status=$/mu);
  });

  it("reattaches to an unknown or empty Expo status for a matching fingerprint", () => {
    const unknown = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      JSON.stringify([
        {
          id: "9312795f-d30f-4cc8-a20b-aea2931a4232",
          platform: "IOS",
          buildProfile: "production",
          status: "PENDING_WORKER",
          runtimeVersion: "abc123",
        },
      ]),
    ]);
    assert.include(unknown, "should_build=true");
    assert.include(unknown, "reuse_build_id=9312795f-d30f-4cc8-a20b-aea2931a4232");
    assert.include(unknown, "reuse_status=active");
    assert.include(
      unknown,
      "Reattaching to in-flight EAS cloud IPA 9312795f-d30f-4cc8-a20b-aea2931a4232",
    );

    const emptyStatus = run([
      "--fingerprint-json",
      JSON.stringify({ hash: "abc123" }),
      "--builds-json",
      JSON.stringify([
        {
          id: "347c6b49-e7dd-4c26-b221-efe6761a8222",
          platform: "IOS",
          buildProfile: "production",
          runtimeVersion: "abc123",
        },
      ]),
    ]);
    assert.include(emptyStatus, "reuse_build_id=347c6b49-e7dd-4c26-b221-efe6761a8222");
    assert.include(emptyStatus, "reuse_status=active");
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
    assert.include(source, "prefer_eas_cloud_ios");
    assert.include(source, "T3CODE_IOS_ALLOW_EAS_CLOUD");
    assert.include(source, "T3CODE_IOS_LOCAL_XCODE");
    assert.include(source, "Submitted verified TestFlight IPA from EAS cloud build");
    assert.include(source, "/Applications/Xcode-beta.app");
    assert.notInclude(source, "Skipping a new IPA");
    assert.notInclude(source, "xcode_is_store_supported");
    assert.notInclude(source, "No native macos-release TestFlight submit recorded");
    assert.include(source, ".t3-fork/ios-native-submit");
    assert.include(source, "--inflight-file");
    assert.include(source, "ios-eas-inflight");
    assert.include(source, "--no-wait");
    assert.include(source, "await_eas_cloud_build");
    assert.include(source, "T3CODE_IOS_EAS_WAIT_SECONDS:-3600");
    assert.notInclude(source, "T3CODE_IOS_EAS_WAIT_SECONDS:-120");
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
