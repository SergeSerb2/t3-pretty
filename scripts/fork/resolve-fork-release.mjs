#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

const NIGHTLY_TAG = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)$/u;
const FORK_TAG = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)\.fork$/u;
const RUN_MULTIPLIER = 1_000_000n;

function git(...args) {
  return NodeChildProcess.execFileSync("git", args, { encoding: "utf8" }).trim();
}

function findNewestIntegratedNightly() {
  const tags = git("tag", "--list", "v*-nightly.*", "--sort=-version:refname")
    .split("\n")
    .filter(Boolean);

  for (const tag of tags) {
    if (!NIGHTLY_TAG.test(tag)) continue;
    try {
      NodeChildProcess.execFileSync(
        "git",
        ["merge-base", "--is-ancestor", `${tag}^{commit}`, "HEAD"],
        {
          stdio: "ignore",
        },
      );
      return tag;
    } catch {
      // The tag exists locally but is not part of the fork yet.
    }
  }

  return null;
}

function resolveRunNumber() {
  // Buildkite's GitHub Actions importer often sets GITHUB_RUN_NUMBER to 0.
  // Prefer a value that fits the fork-build slot.
  for (const raw of [process.env.GITHUB_RUN_NUMBER, process.env.BUILDKITE_BUILD_NUMBER]) {
    if (!raw) continue;
    try {
      const runNumber = BigInt(raw);
      if (runNumber > 0n && runNumber < RUN_MULTIPLIER) return runNumber;
    } catch {
      // not an integer
    }
  }
  // Imported Buildkite jobs often have neither variable. A millisecond
  // slot still keeps versions unique and below the 1_000_000 multiplier.
  const fallback = BigInt(Date.now() % Number(RUN_MULTIPLIER)) || 1n;
  return fallback;
}

function findHighestForkBuild() {
  const tags = git("tag", "--list", "v*-nightly.*.fork").split("\n").filter(Boolean);

  let highest = 0n;
  for (const tag of tags) {
    const match = FORK_TAG.exec(tag);
    if (!match) continue;
    const build = BigInt(match[5] ?? "0");
    if (build > highest) highest = build;
  }
  return highest;
}

function resolveForkBuild(upstreamBuildRaw, runNumber) {
  const candidate = BigInt(upstreamBuildRaw) * RUN_MULTIPLIER + runNumber;
  let highest = findHighestForkBuild();
  // Hosted linux-small cannot fetch Origin fork tags, so the native AppImage
  // packager passes the build slot already live on the public update feed.
  // Without it a fresh checkout can mint below the version clients have.
  const floorRaw = process.env.T3_FORK_BUILD_FLOOR;
  if (floorRaw) {
    try {
      const floor = BigInt(floorRaw);
      if (floor > highest) highest = floor;
    } catch {
      // not an integer
    }
  }
  // electron-updater compares the numeric nightly build slot. A later CI run
  // with a small Buildkite number must not publish below an earlier
  // millisecond-fallback or already-shipped feed version.
  return candidate > highest ? candidate : highest + 1n;
}

function printField(argv) {
  const index = argv.indexOf("--print");
  if (index === -1) return undefined;
  const field = argv[index + 1];
  if (!field) throw new Error("resolve-fork-release.mjs --print needs a field name");
  return field;
}

function writeGitHubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return false;
  NodeFS.appendFileSync(
    outputPath,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
  return true;
}

function main() {
  const field = printField(process.argv.slice(2));
  const runNumber = resolveRunNumber();

  const upstreamTag = findNewestIntegratedNightly();
  if (!upstreamTag) {
    const detail = "No integrated upstream nightly tag is an ancestor of HEAD";
    // Native packagers call `--print` and need a real version. Hosted
    // preflight sets T3_SKIP_UNRESOLVABLE_MINT=1 so a shallow imported
    // checkout can skip minting instead of redding the Buildkite job.
    // Do not infer skip from GITHUB_OUTPUT: a mis-wired Actions output
    // must not swallow a real mint failure.
    if (!field && process.env.T3_SKIP_UNRESOLVABLE_MINT === "1") {
      process.stderr.write(`${detail}; skipping imported version mint.\n`);
      writeGitHubOutput({ minted: "false" });
      return;
    }
    throw new Error(detail);
  }
  const match = NIGHTLY_TAG.exec(upstreamTag);
  if (!match) throw new Error(`Invalid upstream nightly tag: ${upstreamTag}`);

  const [, major, minor, patch, date, upstreamBuildRaw] = match;
  const forkBuild = resolveForkBuild(upstreamBuildRaw, runNumber);
  const version = `${major}.${minor}.${patch}-nightly.${date}.${forkBuild}`;
  // electron-updater parses GitHub release tags as semver before matching the
  // configured prerelease channel. Keep the fork marker as a prerelease
  // identifier so the tag remains both fork-specific and semver-valid.
  const tag = `v${version}.fork`;
  const values = {
    minted: "true",
    upstream_tag: upstreamTag,
    version,
    tag,
    name: `T3 Pretty ${version}`,
    short_sha: git("rev-parse", "--short=9", "HEAD"),
  };

  if (field) {
    const value = values[field];
    if (value == null) throw new Error(`Unknown --print field: ${field}`);
    process.stdout.write(`${value}\n`);
    return;
  }

  if (!writeGitHubOutput(values)) {
    process.stdout.write(`${JSON.stringify(values, null, 2)}\n`);
  }
}

main();
