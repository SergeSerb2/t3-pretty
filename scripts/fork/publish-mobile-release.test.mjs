import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mobileRelease = NodeFS.readFileSync(
  NodePath.resolve(here, "publish-mobile-release.sh"),
  "utf8",
);

function git(cwd, ...args) {
  return NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function hasParent(cwd) {
  try {
    git(cwd, "rev-parse", "--verify", "--quiet", "HEAD~1");
    return true;
  } catch {
    return false;
  }
}

function makeShallowCheckout() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-shallow-"));
  const origin = NodePath.join(root, "origin");
  const work = NodePath.join(root, "work");
  NodeFS.mkdirSync(origin);
  git(origin, "init", "-b", "main");
  git(origin, "config", "user.email", "t3-ios-shallow-test@example.invalid");
  git(origin, "config", "user.name", "T3 iOS Shallow Test");
  NodeFS.writeFileSync(NodePath.join(origin, "apps-mobile.txt"), "mobile-base\n");
  git(origin, "add", "apps-mobile.txt");
  git(origin, "commit", "-m", "mobile base");
  NodeFS.writeFileSync(NodePath.join(origin, "ci.txt"), "one\n");
  git(origin, "add", "ci.txt");
  git(origin, "commit", "-m", "ci only");
  const commit = git(origin, "rev-parse", "HEAD");
  NodeChildProcess.execFileSync(
    "git",
    ["clone", "--depth=1", "--no-local", `file://${origin}`, work],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  git(work, "fetch", "--force", "origin", commit);
  git(work, "-c", "advice.detachedHead=false", "checkout", "--force", "FETCH_HEAD");
  return { root, origin, work, commit };
}

describe("iOS publish shallow history", () => {
  it("keeps HEAD~1 after fetching origin/main the way the release script does", () => {
    const { root, work, commit } = makeShallowCheckout();
    try {
      assert.isFalse(hasParent(work), "depth-1 checkout must start without a parent");

      NodeChildProcess.execFileSync(
        "bash",
        [
          "-c",
          `git fetch --depth=50 origin "$1" main ||
  git fetch --depth=50 origin main ||
  git fetch --deepen=50 origin "$1" ||
  git fetch --deepen=50 ||
  true`,
          "ios-history",
          commit,
        ],
        { cwd: work, encoding: "utf8" },
      );

      assert.isTrue(hasParent(work));
      assert.equal(git(work, "rev-parse", "HEAD"), commit);
      assert.equal(git(work, "rev-parse", "origin/main"), commit);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loses HEAD~1 when origin/main is fetched at depth 1 after a deepen", () => {
    const { root, work } = makeShallowCheckout();
    try {
      git(work, "fetch", "--deepen=50");
      assert.isTrue(hasParent(work));
      git(work, "fetch", "--depth=1", "origin", "main");
      assert.isFalse(hasParent(work));
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("embeds the depth-50 fetch and refuses a later depth-1 origin/main fetch", () => {
    assert.include(mobileRelease, 'git fetch --depth=50 origin "${commit}" main');
    assert.include(mobileRelease, "Never fetch");
    assert.include(mobileRelease, "--depth=1 afterward");
    assert.notInclude(mobileRelease, "git fetch --depth=1 origin main");
    assert.include(mobileRelease, "No parent commit after history fetch");
    assert.include(mobileRelease, "refusing to publish OTA without a path diff");
  });
});

function extractIsFullXcode() {
  const match = mobileRelease.match(/is_full_xcode\(\) \{\n[\s\S]*?\n\}/);
  assert.ok(match, "is_full_xcode function missing");
  return match[0];
}

function extractPreferLocalXcodeIos() {
  const match = mobileRelease.match(/prefer_local_xcode_ios\(\) \{\n[\s\S]*?\n\}/);
  assert.ok(match, "prefer_local_xcode_ios function missing");
  return match[0];
}

function extractPreferEasCloudIos() {
  const match = mobileRelease.match(/prefer_eas_cloud_ios\(\) \{\n[\s\S]*?\n\}/);
  assert.ok(match, "prefer_eas_cloud_ios function missing");
  return match[0];
}

function runBashPredicate(source, name, env = {}) {
  try {
    NodeChildProcess.execFileSync("bash", ["-c", `${source}\n${name}`], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function extractXcodeSearch() {
  const match = mobileRelease.match(/developer_dir=""\nif is_full_xcode[\s\S]*?done\nfi/);
  assert.ok(match, "Xcode search loop missing");
  return match[0].replaceAll("/Applications", '"$apps"');
}

function installFakeXcode(applicationsDir, appName, runnable, beta = false, build = "16A242d") {
  const developerDir = NodePath.join(applicationsDir, appName, "Contents", "Developer");
  NodeFS.mkdirSync(NodePath.join(developerDir, "usr", "bin"), { recursive: true });
  if (beta) {
    const resources = NodePath.join(developerDir, "..", "Resources");
    NodeFS.mkdirSync(resources, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(resources, "BetaVersion.plist"), "beta\n");
  }
  NodeFS.writeFileSync(
    NodePath.join(developerDir, "usr", "bin", "xcodebuild"),
    runnable
      ? `#!/bin/bash\necho 'Xcode 26.0'\necho 'Build version ${build}'\nexit 0\n`
      : "#!/bin/bash\necho 'this Xcode is not compatible with this macOS' >&2\nexit 1\n",
    { mode: 0o755 },
  );
  return developerDir;
}

function runIsFullXcode(fn, developerDir, env = {}) {
  try {
    NodeChildProcess.execFileSync(
      "bash",
      ["-c", `${fn}\nis_full_xcode "$1"`, "is_full_xcode", developerDir],
      { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    return true;
  } catch {
    return false;
  }
}

function selectDeveloperDir({ apps, env = {} }) {
  return NodeChildProcess.execFileSync(
    "bash",
    [
      "-c",
      `${extractIsFullXcode()}\napps="$1"\n${extractXcodeSearch()}\nprintf '%s' "$developer_dir"`,
      "select-xcode",
      apps,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function extractBuildFingerprintConfiguration() {
  const match = mobileRelease.match(
    /configure_eas_build_fingerprint\(\) \{[\s\S]*?\n\}\n\nconfigure_eas_submit_credentials/,
  );
  assert.ok(match, "build fingerprint configuration missing");
  return match[0].replace(/\n\nconfigure_eas_submit_credentials$/u, "");
}

function extractIpaFingerprintVerification() {
  const match = mobileRelease.match(/verify_ipa_fingerprint\(\) \{\n[\s\S]*?\n\}/);
  assert.ok(match, "IPA fingerprint verification missing");
  return match[0];
}

function extractCloudBuildDetailsReader() {
  const match = mobileRelease.match(
    /read_eas_cloud_build_details\(\) \{[\s\S]*?\n\}\n\nreport_eas_cloud_build_failure/,
  );
  assert.ok(match, "cloud build details reader missing");
  return match[0].replace(/\n\nreport_eas_cloud_build_failure$/u, "");
}

function extractCloudBuildFailureReporter() {
  const match = mobileRelease.match(
    /report_eas_cloud_build_failure\(\) \{[\s\S]*?\n\}\n\nverify_ipa_fingerprint/,
  );
  assert.ok(match, "cloud build failure reporter missing");
  return match[0].replace(/\n\nverify_ipa_fingerprint$/u, "");
}

function extractSubmitCredentialConfiguration() {
  const match = mobileRelease.match(
    /configure_eas_submit_credentials\(\) \{[\s\S]*?\n\}\n\nread_eas_cloud_build_details/,
  );
  assert.ok(match, "submit credential configuration missing");
  return match[0].replace(/\n\nread_eas_cloud_build_details$/u, "");
}

function extractEasJsonCleanupTrap() {
  const match = mobileRelease.match(/cleanup\(\) \{[\s\S]*?\n\}\ntrap cleanup EXIT/);
  assert.ok(match, "eas.json cleanup trap missing");
  return match[0];
}

function makeFingerprintIpa({ fingerprint, runtimeVersion } = {}) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-fingerprint-ipa-"));
  const app = NodePath.join(root, "Payload", "T3PrettyInternal.app");
  NodeFS.mkdirSync(app, { recursive: true });
  if (fingerprint !== undefined) {
    const updates = NodePath.join(app, "EXUpdates.bundle");
    NodeFS.mkdirSync(updates);
    NodeFS.writeFileSync(NodePath.join(updates, "fingerprint"), fingerprint);
  }
  if (runtimeVersion !== undefined) {
    NodeFS.writeFileSync(
      NodePath.join(app, "Expo.plist"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0"><dict>',
        "<key>EXUpdatesRuntimeVersion</key>",
        `<string>${runtimeVersion}</string>`,
        "</dict></plist>",
      ].join("\n"),
    );
  }
  const ipa = NodePath.join(root, "T3PrettyInternal.ipa");
  NodeChildProcess.execFileSync("zip", ["-q", "-r", ipa, "Payload"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { root, ipa };
}

function verifyIpaFingerprint(ipa, expected) {
  return NodeChildProcess.spawnSync(
    "bash",
    [
      "-c",
      `${extractIpaFingerprintVerification()}\nverify_ipa_fingerprint "$1" "$2"`,
      "verify-ipa-fingerprint",
      ipa,
      expected,
    ],
    { encoding: "utf8" },
  );
}

function extractOtaBaseFns() {
  const line = mobileRelease.match(/native_submit_line\(\) \{\n[\s\S]*?\n\}/);
  const base = mobileRelease.match(/mobile_release_base\(\) \{\n[\s\S]*?\n\}/);
  assert.ok(line, "native_submit_line missing");
  assert.ok(base, "mobile_release_base missing");
  return `${line[0]}\n${base[0]}`;
}

function makeOtaBaseRepo() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-ota-base-"));
  const work = NodePath.join(root, "work");
  NodeFS.mkdirSync(work);
  git(work, "init", "-b", "main");
  git(work, "config", "user.email", "t3-ios-ota-base-test@example.invalid");
  git(work, "config", "user.name", "T3 iOS OTA Base Test");
  NodeFS.writeFileSync(NodePath.join(work, "apps-mobile.txt"), "one\n");
  git(work, "add", "apps-mobile.txt");
  git(work, "commit", "-m", "mobile one");
  const parent = git(work, "rev-parse", "HEAD");
  NodeFS.writeFileSync(NodePath.join(work, "apps-mobile.txt"), "two\n");
  git(work, "add", "apps-mobile.txt");
  git(work, "commit", "-m", "mobile two");
  const head = git(work, "rev-parse", "HEAD");
  return { root, work, parent, head };
}

function resolveOtaBase({ work, commit, markContent }) {
  const mark = NodePath.join(work, "ota-mark");
  if (markContent === undefined) NodeFS.rmSync(mark, { force: true });
  else NodeFS.writeFileSync(mark, `${markContent}\n`);
  return NodeChildProcess.execFileSync(
    "bash",
    [
      "-c",
      `${extractOtaBaseFns()}
LOCAL_OTA_MARK="$1"
commit="$2"
mobile_release_base`,
      "ota-base",
      mark,
      commit,
    ],
    { cwd: work, encoding: "utf8" },
  ).trim();
}

describe("iOS publish OTA catch-up base", () => {
  it("diffs against the runner's last published OTA commit instead of always HEAD~1", () => {
    assert.include(mobileRelease, "ios-ota-publish");
    assert.include(mobileRelease, "record_local_ota_publish");
    assert.notInclude(mobileRelease, "Push does not change mobile-relevant paths");
    // A skip must not exit before the native fingerprint gate, or a cancelled
    // build would strand a due TestFlight IPA with the OTA it did publish.
    assert.include(mobileRelease, "skipping eas update");
    // A single fingerprint flake must not decide the native gate either way.
    assert.include(mobileRelease, "retrying once");
    assert.isBelow(
      mobileRelease.indexOf("skipping eas update"),
      mobileRelease.indexOf("fingerprint:generate"),
    );
  });

  it("resolves covered/ancestor/missing/unknown marks", () => {
    const { root, work, parent, head } = makeOtaBaseRepo();
    try {
      assert.equal(resolveOtaBase({ work, commit: head, markContent: head }), "covered");
      assert.equal(resolveOtaBase({ work, commit: head, markContent: parent }), parent);
      // A job on an older SHA has the older commit checked out; a newer mark
      // must cover it so its stale bundle cannot regress the channel.
      git(work, "-c", "advice.detachedHead=false", "checkout", "--quiet", parent);
      assert.equal(resolveOtaBase({ work, commit: parent, markContent: head }), "covered");
      git(work, "checkout", "--quiet", "main");
      assert.equal(resolveOtaBase({ work, commit: head }), "HEAD~1");
      assert.equal(resolveOtaBase({ work, commit: head, markContent: "1".repeat(40) }), "changed");
      assert.equal(resolveOtaBase({ work, commit: head, markContent: "bogus" }), "changed");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a newer OTA mark when an older job finishes late", () => {
    const { root, work, parent, head } = makeOtaBaseRepo();
    try {
      const record = mobileRelease.match(/record_local_ota_publish\(\) \{\n[\s\S]*?\n\}/);
      const line = mobileRelease.match(/native_submit_line\(\) \{\n[\s\S]*?\n\}/);
      assert.ok(record, "record_local_ota_publish missing");
      assert.ok(line, "native_submit_line missing");
      const run = (markContent, sha) => {
        const mark = NodePath.join(work, "ota-mark");
        NodeFS.writeFileSync(mark, `${markContent}\n`);
        NodeChildProcess.execFileSync(
          "bash",
          [
            "-c",
            `${line[0]}\n${record[0]}\nLOCAL_OTA_MARK="$1"\ncommit="$2"\nrecord_local_ota_publish`,
            "ota-record",
            mark,
            sha,
          ],
          { cwd: work, encoding: "utf8" },
        );
        return NodeFS.readFileSync(mark, "utf8").trim();
      };
      assert.equal(run(head, parent), head, "older publish must not regress the mark");
      assert.equal(run(parent, head), head, "newer publish advances the mark");
      assert.equal(run("bogus", head), head, "unreadable marks are replaced");
      assert.equal(
        run("1".repeat(40), parent),
        "1".repeat(40),
        "a mark the shallow clone cannot resolve is kept, not regressed",
      );
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("iOS publish Xcode selection", () => {
  it("probes xcodebuild -version inside is_full_xcode before accepting a path", () => {
    const fn = extractIsFullXcode();
    assert.include(fn, 'DEVELOPER_DIR="$1"');
    assert.include(fn, "xcodebuild");
    assert.include(fn, "-version");
    assert.isBelow(
      mobileRelease.indexOf("/Applications/Xcode.app"),
      mobileRelease.indexOf("/Applications/Xcode-beta.app"),
    );
  });

  it("accepts the current beta but rejects stale Xcode installs and Command Line Tools", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-xcode-"));
    try {
      const fn = extractIsFullXcode();
      const broken = installFakeXcode(root, "Xcode.app", false);
      const working = installFakeXcode(root, "Xcode-stable.app", true);
      const currentBeta = installFakeXcode(root, "Xcode-beta.app", true, false, "27A5252f");
      const staleBeta = installFakeXcode(root, "Stale.app", true, true);
      const renamedBeta = installFakeXcode(root, "Renamed.app", true, true, "27A5252f");
      const clt = installFakeXcode(root, "CommandLineTools", true);

      assert.isFalse(runIsFullXcode(fn, ""));
      assert.isFalse(runIsFullXcode(fn, broken));
      assert.isFalse(runIsFullXcode(fn, clt));
      assert.isTrue(runIsFullXcode(fn, currentBeta));
      assert.isFalse(runIsFullXcode(fn, staleBeta));
      assert.isTrue(runIsFullXcode(fn, renamedBeta));
      assert.isTrue(runIsFullXcode(fn, staleBeta, { T3CODE_ACCEPTED_XCODE_BETA_BUILD: "16A242d" }));
      assert.isTrue(runIsFullXcode(fn, working));
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the current beta and rejects an older beta", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-xcode-search-"));
    try {
      const apps = NodePath.join(root, "Applications");
      NodeFS.mkdirSync(apps);
      installFakeXcode(apps, "Xcode.app", false);
      const beta = installFakeXcode(apps, "Xcode-beta.app", true, false, "27A5252f");

      assert.equal(selectDeveloperDir({ apps, env: { DEVELOPER_DIR: "" } }), beta);
      assert.equal(
        selectDeveloperDir({
          apps,
          env: { DEVELOPER_DIR: beta },
        }),
        beta,
      );

      installFakeXcode(apps, "Xcode-beta.app", true, false, "27A5209h");
      assert.equal(selectDeveloperDir({ apps, env: { DEVELOPER_DIR: "" } }), "");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("still prefers a runnable Xcode.app over Xcode-beta.app", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-xcode-prefer-"));
    try {
      const apps = NodePath.join(root, "Applications");
      NodeFS.mkdirSync(apps);
      const stable = installFakeXcode(apps, "Xcode.app", true);
      installFakeXcode(apps, "Xcode-beta.app", true, false, "27A5252f");

      assert.equal(selectDeveloperDir({ apps, env: { DEVELOPER_DIR: "" } }), stable);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses EAS cloud when Xcode is missing and keeps local Xcode opt-in", () => {
    assert.isFalse(
      runBashPredicate(extractPreferLocalXcodeIos(), "prefer_local_xcode_ios", {
        T3CODE_IOS_LOCAL_XCODE: "",
      }),
    );
    assert.isTrue(
      runBashPredicate(extractPreferLocalXcodeIos(), "prefer_local_xcode_ios", {
        T3CODE_IOS_LOCAL_XCODE: "1",
      }),
    );
    assert.isFalse(
      runBashPredicate(extractPreferEasCloudIos(), "prefer_eas_cloud_ios", {
        T3CODE_IOS_ALLOW_EAS_CLOUD: "",
      }),
    );
    assert.isTrue(
      runBashPredicate(extractPreferEasCloudIos(), "prefer_eas_cloud_ios", {
        T3CODE_IOS_ALLOW_EAS_CLOUD: "1",
      }),
    );
    assert.isTrue(
      runBashPredicate(extractPreferEasCloudIos(), "prefer_eas_cloud_ios", {
        T3CODE_IOS_PREFER_EAS_CLOUD: "YES",
      }),
    );

    const gate = mobileRelease.slice(
      mobileRelease.indexOf("ipa_via_cloud=false"),
      mobileRelease.indexOf('ipa_via_cloud" == "true" ]] && ! command -v curl'),
    );
    assert.include(gate, "prefer_local_xcode_ios");
    assert.include(gate, "prefer_eas_cloud_ios");
    assert.include(gate, "T3CODE_IOS_LOCAL_XCODE is set");
    assert.include(gate, "Compiling the TestFlight IPA on EAS cloud.");
    assert.include(gate, "exit 1");
    assert.include(gate, "annotate error");
    assert.include(gate, "ipa_via_cloud=true");
    assert.notInclude(gate, "Cloud IPA builds are opt-in");
  });

  it("skips Expo OTA and cloud IPA when the Vancouver daily cap is exhausted", () => {
    const field = mobileRelease.match(/ios_expo_daily_cap_field\(\) \{\n[\s\S]*?\n\}/);
    const blocks = mobileRelease.match(/ios_expo_cap_blocks\(\) \{\n[\s\S]*?\n\}/);
    assert.ok(field, "ios_expo_daily_cap_field missing");
    assert.ok(blocks, "ios_expo_cap_blocks missing");
    const source = `${field[0]}\n${blocks[0]}`;
    const run = (kind, report) => {
      const result = NodeChildProcess.spawnSync(
        "bash",
        ["-c", `${source}\nios_expo_cap_blocks "$1" "$2"`, "cap-blocks", kind, report],
        { encoding: "utf8" },
      );
      return result.status === 0;
    };
    const capped = [
      "day=2026-09-24",
      "used=2",
      "limit=2",
      "remaining=0",
      "status=ok",
      "allowed=false",
    ].join("\n");
    const open = capped
      .replace("used=2", "used=1")
      .replace("remaining=0", "remaining=1")
      .replace("allowed=false", "allowed=true");
    const unknown = [
      "day=2026-09-24",
      "used=-1",
      "limit=2",
      "remaining=-1",
      "status=unknown",
      "allowed=true",
    ].join("\n");
    assert.isTrue(run("update", capped));
    assert.isTrue(run("build", capped));
    assert.isFalse(run("update", open));
    assert.isFalse(run("build", open));
    assert.isFalse(run("update", unknown));
    assert.isTrue(run("build", unknown));
    assert.isFalse(run("update", "status=disabled\nremaining=unlimited"));
    assert.include(mobileRelease, "ios-expo-daily-cap.mjs");
    assert.include(mobileRelease, "America/Vancouver");
    assert.isBelow(
      mobileRelease.indexOf("ios_expo_cap_blocks update"),
      mobileRelease.indexOf("        eas update \\"),
    );
    assert.isBelow(
      mobileRelease.indexOf("ios_expo_cap_blocks build"),
      mobileRelease.indexOf("    eas build \\"),
    );
  });
});

describe("iOS embedded runtime fingerprint", () => {
  it("fails the job directly when a stable fingerprint cannot be generated", () => {
    const failure = mobileRelease.match(
      /if \(\( fingerprint_attempts >= 2 \)\); then[\s\S]*?\n    fi/,
    );
    assert.ok(failure);
    assert.include(failure[0], "refusing a native build");
    assert.include(failure[0], "exit 1");
    assert.notInclude(failure[0], "fingerprint=unknown");
    assert.notInclude(failure[0], "should_build=true");
  });

  it("pins the build worker to the fingerprint used by the OTA and native gate", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-eas-json-"));
    const easJson = NodePath.join(root, "eas.json");
    const exportedFingerprint = NodePath.join(root, "exported-fingerprint");
    const expected = "f4da50b3d2326db6b7f34aa680546943796adc3b";
    try {
      NodeFS.writeFileSync(
        easJson,
        `${JSON.stringify({ build: { production: { env: { APP_VARIANT: "production" } } } })}\n`,
      );
      NodeChildProcess.execFileSync(
        "bash",
        [
          "-c",
          `${extractBuildFingerprintConfiguration()}\neas_json="$1"\nconfigure_eas_build_fingerprint "$2" internal\nprintf '%s' "$EXPO_UPDATES_FINGERPRINT_OVERRIDE" > "$3"`,
          "configure-build-fingerprint",
          easJson,
          expected,
          exportedFingerprint,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );

      const configured = JSON.parse(NodeFS.readFileSync(easJson, "utf8"));
      assert.equal(configured.build.production.env.APP_VARIANT, "production");
      assert.equal(configured.build.production.env.T3CODE_BUILD_FLAVOR, "internal");
      assert.equal(configured.build.production.env.EXPO_PUBLIC_T3CODE_BUILD_FLAVOR, "internal");
      assert.equal(configured.build.production.env.VITE_T3CODE_BUILD_FLAVOR, "internal");
      assert.equal(configured.build.production.env.EXPO_UPDATES_FINGERPRINT_OVERRIDE, expected);
      assert.equal(NodeFS.readFileSync(exportedFingerprint, "utf8"), expected);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("downloads the application archive from EAS cloud output", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-cloud-build-"));
    const buildJson = NodePath.join(root, "build.json");
    const buildId = "467e7759-a0d5-47d6-a8b5-9be5a14f3aa4";
    const applicationArchiveUrl = "https://expo.invalid/application.ipa";
    try {
      const readDetails = () =>
        NodeChildProcess.execFileSync(
          "bash",
          [
            "-c",
            `${extractCloudBuildDetailsReader()}\nread_eas_cloud_build_details "$1"`,
            "read-cloud-build",
            buildJson,
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        )
          .trim()
          .split("\n");

      NodeFS.writeFileSync(
        buildJson,
        `${JSON.stringify([
          {
            id: buildId,
            artifacts: {
              applicationArchiveUrl,
              buildUrl: "https://expo.invalid/extra-build-artifact.tar.gz",
            },
          },
        ])}\n`,
      );
      assert.deepEqual(readDetails(), [buildId, applicationArchiveUrl]);

      const legacyBuildUrl = "https://expo.invalid/legacy-build.ipa";
      NodeFS.writeFileSync(
        buildJson,
        `EAS output follows\n${JSON.stringify({
          id: buildId,
          artifacts: { buildUrl: legacyBuildUrl },
        })}\n`,
      );
      assert.deepEqual(readDetails(), [buildId, legacyBuildUrl]);

      const finalBuildId = "c002d0fa-6063-49e8-ace6-cb51779f1c53";
      const finalArchiveUrl = "https://expo.invalid/final-application.ipa";
      NodeFS.writeFileSync(
        buildJson,
        [
          "progress {not valid JSON around the later values:",
          JSON.stringify({
            status: "IN_QUEUE",
            progress: { message: "Waiting [for a worker]", position: 1 },
          }),
          JSON.stringify([
            {
              id: buildId,
              artifacts: { applicationArchiveUrl },
            },
            {
              id: finalBuildId,
              metadata: { nested: [{ message: "complete" }] },
              artifacts: { applicationArchiveUrl: finalArchiveUrl },
            },
          ]),
          "}",
        ].join("\n"),
      );
      assert.deepEqual(readDetails(), [finalBuildId, finalArchiveUrl]);

      NodeFS.writeFileSync(
        buildJson,
        `${JSON.stringify([
          {
            id: finalBuildId,
            artifacts: { applicationArchiveUrl: finalArchiveUrl },
          },
          { id: "", artifacts: { applicationArchiveUrl: "" } },
        ])}\n`,
      );
      assert.deepEqual(readDetails(), [finalBuildId, finalArchiveUrl]);

      NodeFS.writeFileSync(
        buildJson,
        `${JSON.stringify({
          id: buildId,
          artifacts: { applicationArchiveUrl: "", buildUrl: legacyBuildUrl },
        })}\n`,
      );
      assert.deepEqual(readDetails(), [buildId, legacyBuildUrl]);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints the EAS JSON error when the cloud IPA fails", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-cloud-fail-"));
    const buildJson = NodePath.join(root, "build.json");
    const buildId = "18d3e8b4-7747-4b9e-8cb5-365a529313de";
    try {
      const reportFailure = (jsonPath) =>
        NodeChildProcess.spawnSync(
          "bash",
          [
            "-c",
            `${extractCloudBuildFailureReporter()}\nreport_eas_cloud_build_failure "$1"`,
            "report-cloud-build-failure",
            jsonPath,
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              T3CODE_MOBILE_EXPO_OWNER: "sergeserbinenkoteam",
              T3CODE_MOBILE_EXPO_SLUG: "t3-pretty",
            },
          },
        );

      NodeFS.writeFileSync(
        buildJson,
        [
          "progress {not valid JSON around the later values:",
          JSON.stringify({
            status: "IN_PROGRESS",
            progress: { message: "Spinning up build environment" },
          }),
          JSON.stringify({
            id: buildId,
            status: "ERRORED",
            buildPhase: "INSTALL_DEPENDENCIES",
            error: {
              errorCode: "EAS_BUILD_UNKNOWN_ERROR",
              message:
                "Failed to install pnpm. Make sure you specified the correct version in eas.json.",
            },
          }),
          "}",
        ].join("\n"),
      );

      const reported = reportFailure(buildJson);
      assert.equal(reported.status, 0);
      assert.include(reported.stderr, `EAS cloud build id=${buildId}`);
      assert.include(reported.stderr, "status=ERRORED");
      assert.include(reported.stderr, "phase=INSTALL_DEPENDENCIES");
      assert.include(reported.stderr, "errorCode=EAS_BUILD_UNKNOWN_ERROR");
      assert.include(reported.stderr, "Failed to install pnpm");
      assert.include(
        reported.stderr,
        `https://expo.dev/accounts/sergeserbinenkoteam/projects/t3-pretty/builds/${buildId}`,
      );

      const missing = reportFailure(NodePath.join(root, "missing.json"));
      assert.equal(missing.status, 0);
      assert.include(missing.stderr, "produced no JSON output");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("dumps the EAS JSON error instead of exiting on a bare ✖ Build failed", () => {
    const cloud = mobileRelease.slice(
      mobileRelease.indexOf('ipa_via_cloud" == "true"'),
      mobileRelease.indexOf("Using Xcode at"),
    );
    assert.include(cloud, "if ! (");
    assert.include(cloud, 'report_eas_cloud_build_failure "$cloud_build_json"');
    assert.include(cloud, "EAS cloud iOS build failed.");
  });

  it("does not bake Internal flavor into committed eas.json production env", () => {
    // Public Android reuses this profile against a different EAS project.
    // Hardcoding internal here would make that worker prebuild the Internal app.
    const eas = JSON.parse(
      NodeFS.readFileSync(NodePath.resolve(here, "../../apps/mobile/eas.json"), "utf8"),
    );
    assert.equal(eas.build.production.env.T3CODE_BUILD_FLAVOR, undefined);
    assert.notInclude(mobileRelease, 'T3CODE_BUILD_FLAVOR="${T3CODE_BUILD_FLAVOR:-internal}"');
    assert.include(mobileRelease, "require_ios_internal_flavor");
    assert.include(mobileRelease, 'configure_eas_build_fingerprint "$fingerprint" internal');
    assert.include(mobileRelease, 'if (buildFlavor === "internal")');
    assert.include(mobileRelease, "credentials still point at");
    const nativePath = mobileRelease.slice(mobileRelease.indexOf('MODE" != "build"'));
    assert.isBelow(
      nativePath.indexOf("require_ios_internal_flavor"),
      nativePath.indexOf("eas fingerprint:generate"),
    );
  });

  it("omits flavor keys from the shared production profile unless iOS Internal is explicit", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-eas-flavor-"));
    const easJson = NodePath.join(root, "eas.json");
    try {
      NodeFS.writeFileSync(
        easJson,
        `${JSON.stringify({ build: { production: { env: { APP_VARIANT: "production" } } } })}\n`,
      );
      const run = (flavorArg) => {
        NodeFS.writeFileSync(
          easJson,
          `${JSON.stringify({ build: { production: { env: { APP_VARIANT: "production" } } } })}\n`,
        );
        NodeChildProcess.execFileSync(
          "bash",
          [
            "-c",
            `${extractBuildFingerprintConfiguration()}\neas_json="$1"\nconfigure_eas_build_fingerprint "$2" "$3"`,
            "configure-build-fingerprint",
            easJson,
            "deadbeef",
            flavorArg,
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        return JSON.parse(NodeFS.readFileSync(easJson, "utf8"));
      };

      const omitted = run("");
      assert.equal(omitted.build.production.env.APP_VARIANT, "production");
      assert.equal(omitted.build.production.env.T3CODE_BUILD_FLAVOR, undefined);
      assert.equal(omitted.build.production.env.EXPO_PUBLIC_T3CODE_BUILD_FLAVOR, undefined);
      assert.equal(omitted.build.production.env.VITE_T3CODE_BUILD_FLAVOR, undefined);
      assert.equal(omitted.build.production.env.EXPO_UPDATES_FINGERPRINT_OVERRIDE, "deadbeef");

      const publicFlavor = run("public");
      assert.equal(publicFlavor.build.production.env.T3CODE_BUILD_FLAVOR, undefined);
      assert.equal(publicFlavor.build.production.env.EXPO_UPDATES_FINGERPRINT_OVERRIDE, "deadbeef");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to pin Internal when the process already has a public flavor", () => {
    const script = mobileRelease.match(
      /require_ios_internal_flavor\(\) \{[\s\S]*?\n\}\n\nconfigure_eas_build_fingerprint/,
    );
    assert.ok(script, "require_ios_internal_flavor missing");
    const requireFn = script[0].replace(/\n\nconfigure_eas_build_fingerprint$/u, "");
    const result = NodeChildProcess.spawnSync(
      "bash",
      ["-c", `${requireFn}\nrequire_ios_internal_flavor`],
      {
        encoding: "utf8",
        env: { ...process.env, T3CODE_BUILD_FLAVOR: "public" },
      },
    );
    assert.notEqual(result.status, 0);
    assert.include(result.stderr, "T3CODE_BUILD_FLAVOR=internal");
    assert.include(result.stderr, "public");

    const unset = NodeChildProcess.spawnSync(
      "bash",
      [
        "-c",
        `${requireFn}\nrequire_ios_internal_flavor\nprintf '%s\\n' "$T3CODE_BUILD_FLAVOR" "$EXPO_PUBLIC_T3CODE_BUILD_FLAVOR" "$VITE_T3CODE_BUILD_FLAVOR"`,
      ],
      {
        encoding: "utf8",
        env: Object.fromEntries(
          Object.entries(process.env).filter(([name]) => name !== "T3CODE_BUILD_FLAVOR"),
        ),
      },
    );
    assert.equal(unset.status, 0);
    assert.equal(unset.stdout.trim(), "internal\ninternal\ninternal");
  });

  it("pins Node 24 and pnpm on EAS workers without enabling corepack", () => {
    const eas = JSON.parse(
      NodeFS.readFileSync(NodePath.resolve(here, "../../apps/mobile/eas.json"), "utf8"),
    );
    for (const name of ["development", "preview", "preview:dev", "production"]) {
      const profile = eas.build[name];
      assert.equal(profile.node, "24.13.1", name);
      assert.equal(profile.pnpm, "11.10.0", name);
      assert.equal(profile.corepack, undefined, name);
    }
    assert.equal(eas.build["v2-preview"].extends, "production");
  });

  it("restores eas.json through the early EXIT trap after every mutation stage", () => {
    const trap = mobileRelease.indexOf("trap cleanup EXIT");
    const backupCopy = mobileRelease.indexOf('cp "$eas_json" "$tmp/eas.json.bak"');
    const backupActivation = mobileRelease.indexOf('eas_json_bak="$tmp/eas.json.bak"');
    const firstMutation = mobileRelease.indexOf('configure_eas_build_fingerprint "$fingerprint"');
    assert.isAtLeast(trap, 0);
    assert.isAbove(backupCopy, trap);
    assert.isAbove(backupActivation, backupCopy);
    assert.isAbove(firstMutation, backupActivation);

    for (const stage of ["backup", "build", "submit"]) {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-eas-cleanup-"));
      const tmp = NodePath.join(root, "release-tmp");
      const easJson = NodePath.join(root, "eas.json");
      const lockLog = NodePath.join(root, "lock-release.log");
      const original = `${JSON.stringify({
        build: { production: { env: { APP_VARIANT: "production" } } },
        submit: { production: { ios: { appleTeamId: "team" } } },
      })}\n`;
      NodeFS.mkdirSync(tmp);
      NodeFS.writeFileSync(easJson, original);
      try {
        const result = NodeChildProcess.spawnSync(
          "bash",
          [
            "-c",
            [
              "set -euo pipefail",
              "apple_signing_lock_release() { printf 'released\\n' > \"$lock_log\"; }",
              'eas_json="$1"',
              'tmp="$2"',
              'lock_log="$4"',
              'eas_json_bak=""',
              extractEasJsonCleanupTrap(),
              extractBuildFingerprintConfiguration(),
              extractSubmitCredentialConfiguration(),
              'cp "$eas_json" "$tmp/eas.json.bak"',
              'eas_json_bak="$tmp/eas.json.bak"',
              'if [[ "$3" == "backup" ]]; then printf \'{"partial":true}\\n\' > "$eas_json"; fi',
              'if [[ "$3" == "build" || "$3" == "submit" ]]; then',
              '  configure_eas_build_fingerprint "expected-fingerprint"',
              "fi",
              'if [[ "$3" == "submit" ]]; then',
              '  configure_eas_submit_credentials "/tmp/randomized-key.p8" "key" "issuer"',
              "fi",
              "exit 42",
            ].join("\n"),
            "eas-json-cleanup",
            easJson,
            tmp,
            stage,
            lockLog,
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        assert.equal(result.status, 42, `${stage} failure status must survive cleanup`);
        assert.equal(NodeFS.readFileSync(easJson, "utf8"), original);
        assert.isFalse(NodeFS.existsSync(tmp), `${stage} failure must remove release temp files`);
        assert.equal(NodeFS.readFileSync(lockLog, "utf8"), "released\n");
      } finally {
        NodeFS.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("preserves the backup and releases the signing lock when restoring eas.json fails", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-eas-cleanup-fail-"));
    const tmp = NodePath.join(root, "release-tmp");
    const easJson = NodePath.join(root, "eas.json");
    const lockLog = NodePath.join(root, "lock-release.log");
    NodeFS.mkdirSync(tmp);
    NodeFS.writeFileSync(easJson, '{"original":true}\n');
    try {
      const result = NodeChildProcess.spawnSync(
        "bash",
        [
          "-c",
          [
            "set -euo pipefail",
            "apple_signing_lock_release() { printf 'released\\n' > \"$lock_log\"; }",
            'eas_json="$1"',
            'tmp="$2"',
            'lock_log="$3"',
            'eas_json_bak=""',
            "cp_calls=0",
            "cp() {",
            "  cp_calls=$((cp_calls + 1))",
            "  if (( cp_calls == 2 )); then return 1; fi",
            '  command cp "$@"',
            "}",
            extractEasJsonCleanupTrap(),
            'cp "$eas_json" "$tmp/eas.json.bak"',
            'eas_json_bak="$tmp/eas.json.bak"',
            'printf \'{"mutated":true}\\n\' > "$eas_json"',
            "exit 0",
          ].join("\n"),
          "eas-json-cleanup-failure",
          easJson,
          tmp,
          lockLog,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      assert.equal(result.status, 1, "restore failure must upgrade a successful exit");
      assert.include(result.stderr, "Could not restore");
      assert.include(result.stderr, NodePath.join(tmp, "eas.json.bak"));
      assert.include(result.stderr, tmp);
      assert.isTrue(NodeFS.existsSync(tmp));
      assert.equal(
        NodeFS.readFileSync(NodePath.join(tmp, "eas.json.bak"), "utf8"),
        '{"original":true}\n',
      );
      assert.equal(NodeFS.readFileSync(easJson, "utf8"), '{"mutated":true}\n');
      assert.equal(NodeFS.readFileSync(lockLog, "utf8"), "released\n");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds before adding the randomized submit key path, then verifies before submit", () => {
    const override = mobileRelease.indexOf('configure_eas_build_fingerprint "$fingerprint"');
    const buildCredential = mobileRelease.indexOf('export EXPO_ASC_API_KEY_PATH="$key_path"');
    const cloudBuild = mobileRelease.indexOf("    eas build \\", override);
    const localBuild = mobileRelease.indexOf("    eas build \\", cloudBuild + 1);
    const verify = mobileRelease.indexOf(
      'verify_ipa_fingerprint "$ipa_path" "$fingerprint"',
      localBuild,
    );
    const submitCredentials = mobileRelease.indexOf(
      'configure_eas_submit_credentials "$key_path"',
      verify,
    );
    const submit = mobileRelease.indexOf("  eas submit \\", submitCredentials);

    assert.isAtLeast(override, 0);
    assert.isAtLeast(buildCredential, 0);
    assert.isBelow(buildCredential, cloudBuild);
    assert.isAbove(cloudBuild, override);
    assert.isAbove(localBuild, cloudBuild);
    assert.isAbove(verify, localBuild);
    assert.isAbove(submitCredentials, verify);
    assert.isAbove(submit, submitCredentials);
    assert.notInclude(mobileRelease.slice(override, verify), "ascApiKeyPath");
    assert.isBelow(
      mobileRelease.indexOf('fingerprint="$verified_fingerprint"', verify),
      mobileRelease.indexOf("> .t3-fork/ios-production-fingerprint", verify),
    );
  });

  it("accepts a matching EXUpdates fingerprint sidecar", () => {
    const embedded = "4ed986f84d740653c1ff27b32a3e0c0a7c139efc";
    const { root, ipa } = makeFingerprintIpa({
      fingerprint: embedded,
      runtimeVersion: "plist-must-not-override-the-sidecar",
    });
    try {
      const matching = verifyIpaFingerprint(ipa, embedded);
      assert.equal(matching.status, 0);
      assert.equal(matching.stdout.trim(), embedded);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the EXUpdates fingerprint sidecar does not match", () => {
    const embedded = "4ed986f84d740653c1ff27b32a3e0c0a7c139efc";
    const { root, ipa } = makeFingerprintIpa({
      fingerprint: embedded,
      runtimeVersion: "f4da50b3d2326db6b7f34aa680546943796adc3b",
    });
    try {
      const mismatched = verifyIpaFingerprint(ipa, "f4da50b3d2326db6b7f34aa680546943796adc3b");
      assert.notEqual(mismatched.status, 0);
      assert.include(mismatched.stderr, "Embedded iOS runtime fingerprint mismatch");
      assert.include(mismatched.stderr, "Refusing TestFlight submit");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to a matching Expo.plist runtime version", () => {
    const embedded = "a21dfbf91ea34506691ef12e24f26e9ddb36b901";
    const { root, ipa } = makeFingerprintIpa({ runtimeVersion: embedded });
    try {
      const matching = verifyIpaFingerprint(ipa, embedded);
      assert.equal(matching.status, 0);
      assert.equal(matching.stdout.trim(), embedded);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the embedded runtime version does not match", () => {
    const embedded = "4ed986f84d740653c1ff27b32a3e0c0a7c139efc";
    const { root, ipa } = makeFingerprintIpa({ runtimeVersion: embedded });
    try {
      const mismatched = verifyIpaFingerprint(ipa, "f4da50b3d2326db6b7f34aa680546943796adc3b");
      assert.notEqual(mismatched.status, 0);
      assert.include(mismatched.stderr, "Embedded iOS runtime fingerprint mismatch");
      assert.include(mismatched.stderr, "Refusing TestFlight submit");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when neither embedded runtime representation is present", () => {
    const { root, ipa } = makeFingerprintIpa();
    try {
      const missing = verifyIpaFingerprint(ipa, "f4da50b3d2326db6b7f34aa680546943796adc3b");
      assert.notEqual(missing.status, 0);
      assert.include(missing.stderr, "neither EXUpdates.bundle/fingerprint nor Expo.plist");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("iOS fingerprint recording", () => {
  it("retries the bookkeeping branch push once", () => {
    const snippet = mobileRelease.match(
      /node scripts\/fork\/origin-forge\.mjs setup-ci\n[\s\S]*?branch="automation\/ios-fingerprint-[^\n]+\n[\s\S]*?\n\}/,
    )?.[0];
    assert.ok(snippet, "fingerprint branch push missing");

    const run = (failures) => {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ios-push-"));
      const log = NodePath.join(directory, "calls.log");
      try {
        const script = [
          "set -e",
          "git_attempts=0",
          `git() { [[ -f "$TEST_LOG" && -z "\${FORCE_COLOR+x}" && -z "\${NO_COLOR+x}" ]] || return 90; git_attempts=$((git_attempts + 1)); printf 'push\\n' >> "$TEST_LOG"; (( git_attempts > FAILURES )); }`,
          "sleep() { :; }",
          `node() { printf 'setup-ci\\n' >> "$TEST_LOG"; }`,
          "fingerprint=fe8118329f9969e50fad032c7ea3c536e6ea6967",
          snippet,
        ].join("\n");
        const result = NodeChildProcess.spawnSync("bash", ["-c", script], {
          encoding: "utf8",
          env: {
            ...process.env,
            FORCE_COLOR: "1",
            NO_COLOR: "1",
            FAILURES: String(failures),
            TEST_LOG: log,
          },
        });
        return { result, calls: NodeFS.readFileSync(log, "utf8").trim().split("\n") };
      } finally {
        NodeFS.rmSync(directory, { recursive: true, force: true });
      }
    };

    const recovered = run(1);
    assert.equal(recovered.result.status, 0);
    assert.deepEqual(recovered.calls, ["setup-ci", "push", "push"]);
    assert.include(recovered.result.stdout, "Fingerprint branch push failed; retrying once.");

    const failed = run(2);
    assert.notEqual(failed.result.status, 0);
    assert.deepEqual(failed.calls, ["setup-ci", "push", "push"]);
  });
});
