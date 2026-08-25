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

  it("uses the current beta and falls back to EAS cloud for an older beta", () => {
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
});

describe("iOS fingerprint recording", () => {
  it("retries the bookkeeping branch push once", () => {
    assert.include(mobileRelease, "Fingerprint branch push failed; retrying once.");
    assert.equal(
      mobileRelease.match(/git push --force origin "HEAD:refs\/heads\/\$branch"/g)?.length,
      2,
    );
  });
});
