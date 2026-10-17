#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const publicUrl = "git@github.com:SergeSerb2/t3-pretty.git";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function git(args, options = {}) {
  return NodeChildProcess.execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    // The tracked path list alone exceeds Node's 1 MiB default in this repo.
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  }).trim();
}

function newerThan(left, right) {
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function main() {
  const { values } = NodeUtil.parseArgs({
    options: { version: { type: "string" }, commit: { type: "string" }, push: { type: "boolean" } },
  });
  const { version, commit } = values;
  if (!version || !stableVersion.test(version) || !commit || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error("Use --version <numeric-semver> --commit <full-Origin-SHA> [--push].");
  }
  if (process.env.CI || process.env.BUILDKITE || process.env.GITHUB_ACTIONS) {
    throw new Error("Public cuts must run manually from a maintainer checkout, outside CI.");
  }
  const origin = git(["config", "--get", "remote.origin.url"]);
  if (!/^https:\/\/origin\.cursor\.com\/(git\/)?serbinenko\/t3-pretty(\.git)?$/.test(origin)) {
    throw new Error("origin must remain the internal serbinenko/t3-pretty repository.");
  }
  git(["fetch", "--no-tags", "origin", "main"]);
  const main = git(["rev-parse", "FETCH_HEAD"]);
  git(["merge-base", "--is-ancestor", commit, main]);
  const workflow = git(["show", `${commit}:.github/workflows/public-release.yml`]);
  const triggers = /^on:\n([\s\S]*?)(?=^\S)/m.exec(workflow)?.[1];
  if (
    !triggers ||
    !/^  workflow_dispatch:$/m.test(triggers) ||
    /^  (?!workflow_dispatch:)[\w-]+:/m.test(triggers)
  ) {
    throw new Error(
      "The selected public workflow must have only a manual workflow_dispatch trigger.",
    );
  }
  git(["fetch", "--no-tags", publicUrl, "main"]);
  const parent = git(["rev-parse", "FETCH_HEAD"]);
  const tag = `public-v${version}`;
  const tags = git(["ls-remote", "--tags", "--refs", publicUrl, "refs/tags/public-v*"]);
  for (const line of tags.split("\n")) {
    const previous = line.split("refs/tags/public-v")[1];
    if (previous && stableVersion.test(previous) && !newerThan(version, previous)) {
      throw new Error(`Public version ${version} must be newer than ${previous}.`);
    }
  }

  // A separate index leaves the maintainer's branch, staged files, and working tree untouched.
  const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-public-cut-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: NodePath.join(temp, "index") };
    const indexedGit = (args, input) => git(args, { env, input });
    indexedGit(["read-tree", commit]);
    const paths = indexedGit(["ls-files", "-z"]).split("\0").filter(Boolean);
    const removed = paths.filter(
      (path) =>
        path.startsWith(".buildkite/") ||
        (path.startsWith(".github/workflows/") && path !== ".github/workflows/public-release.yml"),
    );
    if (removed.length) {
      indexedGit(["update-index", "--force-remove", "-z", "--stdin"], removed.join("\0") + "\0");
    }
    const put = (path, text) => {
      const blob = indexedGit(["hash-object", "-w", "--stdin"], text);
      indexedGit(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
    };
    put("README.md", git(["show", `${commit}:scripts/fork/public-README.md`]) + "\n");
    put(
      ".t3-fork/public-release.json",
      JSON.stringify({ version, originCommit: commit }, null, 2) + "\n",
    );
    const tree = indexedGit(["write-tree"]);
    // Parent only the previous public tip. Internal commits are provenance, not public ancestors.
    const snapshot = git([
      "commit-tree",
      tree,
      "-p",
      parent,
      "-m",
      `release: T3 Pretty ${version}\n\nOrigin-Commit: ${commit}`,
    ]);
    process.stdout.write(
      `Public ${tag}: ${snapshot}\nOrigin source: ${commit}\nPrevious GitHub main: ${parent}\n`,
    );
    if (!values.push) {
      process.stdout.write(
        "Preview only. Review with git diff <previous-main> <snapshot>. Add --push to cut.\n",
      );
      return;
    }
    // No force and no wildcard refs: concurrent cuts fail without partially publishing main or tag.
    git([
      "push",
      "--atomic",
      "--no-thin",
      publicUrl,
      `${snapshot}:refs/heads/main`,
      `${snapshot}:refs/tags/${tag}`,
    ]);
    const published = git(["ls-remote", publicUrl, "refs/heads/main", `refs/tags/${tag}`]);
    if (
      published.split("\n").length !== 2 ||
      published.split("\n").some((line) => !line.startsWith(`${snapshot}\t`))
    ) {
      throw new Error("Public ref verification failed; inspect GitHub before retrying.");
    }
    process.stdout.write(
      `Cut verified. Build and verify version ${version} locally before manual release publication.\n`,
    );
  } finally {
    NodeFS.rmSync(temp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
