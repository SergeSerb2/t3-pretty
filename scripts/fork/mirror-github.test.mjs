import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const scriptPath = NodePath.resolve(here, "mirror-github.sh");
const script = NodeFS.readFileSync(scriptPath, "utf8");
const pipeline = NodeFS.readFileSync(
  NodePath.resolve(here, "../../.buildkite/pipeline.yml"),
  "utf8",
);
it("uses a guarded, one-way public mirror", () => {
  assert.match(script, /GITHUB_MIRROR_SSH_KEY/);
  assert.match(script, /archive\/pre-origin-migration-2026-08-23/);
  assert.match(script, /GitHub main diverged from Origin/);
  assert.match(script, /BUILDKITE_BRANCH/);
  assert.match(script, /SergeSerb2\/t3-pretty/);
  assert.match(script, /force-with-lease/);
  assert.match(script, /push --no-thin/);
  assert.match(
    script,
    /if \[\[ "\$\(git rev-parse --is-shallow-repository\)" == true \]\]; then\s+git fetch --unshallow origin\s+fi\s+git merge-base --is-ancestor/,
  );
  assert.match(script, /--force-with-lease="refs\/heads\/\$archive_branch:"/);
  NodeAssert.doesNotMatch(
    script,
    /--force-with-lease="refs\/heads\/\$archive_branch:\$github_tip"/,
  );
  assert.match(script, /refs\/heads\/main/);
  assert.match(script, /tag_refs\+=\("refs\/tags/);
  assert.match(script, /push --no-thin github "\$\{tag_refs\[@\]\}"/);
  assert.equal((script.match(/push --no-thin github "\$\{tag_refs\[@\]\}"/gu) || []).length, 1);
  assert.match(script, /release_tag_pattern/);
  assert.match(script, /GITHUB_MIRROR_REPO.*SergeSerb2\/t3-pretty/);
  assert.match(script, /git remote set-url github/);
  assert.match(script, /git status --porcelain/);
  NodeAssert.doesNotMatch(script, /git fetch github main --tags/);
  NodeAssert.doesNotMatch(script, /git diff --quiet/);
  NodeAssert.doesNotMatch(script, /refs\/heads\/\*/);
  NodeAssert.doesNotMatch(pipeline, /test -n "\$\{GITHUB_MIRROR_SSH_KEY/);
  assert.match(pipeline, /load-buildkite-secrets\.sh GITHUB_MIRROR_SSH_KEY/);
  assert.match(script, /GITHUB_MIRROR_SSH_KEY:\?/);
});

function git(cwd, ...args) {
  return NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runMirror(cwd) {
  return NodeChildProcess.execFileSync("bash", [scriptPath], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      BUILDKITE_BRANCH: "main",
      GITHUB_MIRROR_REPO: "SergeSerb2/t3-pretty",
      GITHUB_MIRROR_SSH_KEY: "fixture-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

it("repairs shallow ancestry without allowing real divergence", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-mirror-shallow-"));
  const origin = NodePath.join(root, "origin");
  const github = NodePath.join(root, "github.git");
  const work = NodePath.join(root, "work");
  try {
    NodeFS.mkdirSync(origin);
    NodeFS.mkdirSync(github);
    git(origin, "init", "-b", "main");
    git(github, "init", "--bare");
    git(origin, "config", "user.email", "mirror-test@example.invalid");
    git(origin, "config", "user.name", "Mirror Test");
    NodeFS.writeFileSync(NodePath.join(origin, "history.txt"), "base\n");
    git(origin, "add", "history.txt");
    git(origin, "commit", "-m", "base");
    const githubTip = git(origin, "rev-parse", "HEAD");
    git(origin, "remote", "add", "github-fixture", github);
    git(origin, "push", "github-fixture", `${githubTip}:refs/heads/main`);
    git(
      origin,
      "push",
      "github-fixture",
      `${githubTip}:refs/heads/archive/pre-origin-migration-2026-08-23`,
    );
    NodeFS.appendFileSync(NodePath.join(origin, "history.txt"), "origin\n");
    git(origin, "commit", "-am", "origin ahead");
    const originTip = git(origin, "rev-parse", "HEAD");

    NodeChildProcess.execFileSync(
      "git",
      ["clone", "--depth=1", "--no-local", `file://${origin}`, work],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    git(
      work,
      "config",
      `url.file://${github}.insteadOf`,
      "git@github.com:SergeSerb2/t3-pretty.git",
    );
    assert.equal(git(work, "rev-parse", "--is-shallow-repository"), "true");

    runMirror(work);
    assert.equal(git(work, "rev-parse", "--is-shallow-repository"), "false");
    assert.equal(git(github, "rev-parse", "refs/heads/main"), originTip);

    git(origin, "switch", "-c", "diverged", githubTip);
    NodeFS.writeFileSync(NodePath.join(origin, "diverged.txt"), "diverged\n");
    git(origin, "add", "diverged.txt");
    git(origin, "commit", "-m", "diverged");
    const divergedTip = git(origin, "rev-parse", "HEAD");
    git(origin, "push", "--force", "github-fixture", "HEAD:refs/heads/main");
    assert.throws(() => runMirror(work), /GitHub main diverged from Origin/);
    assert.equal(git(github, "rev-parse", "refs/heads/main"), divergedTip);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
