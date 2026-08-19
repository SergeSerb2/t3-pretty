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
