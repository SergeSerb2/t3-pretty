#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

const NIGHTLY_TAG = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)$/u;
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

  throw new Error("No integrated upstream nightly tag is an ancestor of HEAD");
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

function main() {
  const runNumber = resolveRunNumber();

  const upstreamTag = findNewestIntegratedNightly();
  const match = NIGHTLY_TAG.exec(upstreamTag);
  if (!match) throw new Error(`Invalid upstream nightly tag: ${upstreamTag}`);

  const [, major, minor, patch, date, upstreamBuildRaw] = match;
  const forkBuild = BigInt(upstreamBuildRaw) * RUN_MULTIPLIER + runNumber;
  const version = `${major}.${minor}.${patch}-nightly.${date}.${forkBuild}`;
  // electron-updater parses GitHub release tags as semver before matching the
  // configured prerelease channel. Keep the fork marker as a prerelease
  // identifier so the tag remains both fork-specific and semver-valid.
  const tag = `v${version}.fork`;
  const values = {
    upstream_tag: upstreamTag,
    version,
    tag,
    name: `T3 Pretty ${version}`,
    short_sha: git("rev-parse", "--short=9", "HEAD"),
  };

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    NodeFS.appendFileSync(
      outputPath,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") + "\n",
    );
  } else {
    process.stdout.write(`${JSON.stringify(values, null, 2)}\n`);
  }
}

main();
