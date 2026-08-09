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

function main() {
  const runNumber = BigInt(process.env.GITHUB_RUN_NUMBER ?? "0");
  if (runNumber <= 0n || runNumber >= RUN_MULTIPLIER) {
    throw new Error(`GITHUB_RUN_NUMBER must be between 1 and ${RUN_MULTIPLIER - 1n}`);
  }

  const upstreamTag = findNewestIntegratedNightly();
  const match = NIGHTLY_TAG.exec(upstreamTag);
  if (!match) throw new Error(`Invalid upstream nightly tag: ${upstreamTag}`);

  const [, major, minor, patch, date, upstreamBuildRaw] = match;
  const forkBuild = BigInt(upstreamBuildRaw) * RUN_MULTIPLIER + runNumber;
  const version = `${major}.${minor}.${patch}-nightly.${date}.${forkBuild}`;
  const tag = `fork-v${version}`;
  const values = {
    upstream_tag: upstreamTag,
    version,
    tag,
    name: `T3 Code Fork ${version}`,
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
