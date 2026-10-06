import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const version = "0.0.46-nightly.20261005.2702003200";
const nightly = "v0.0.46-nightly.20261005.2702";

function fixture(input = {}) {
  const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-linux-release-recovery-"));
  const repo = NodePath.join(temp, "repo");
  const bin = NodePath.join(temp, "bin");
  const feed = NodePath.join(temp, "feed");
  const pkg = NodePath.join(temp, "package");
  for (const path of [repo, bin, feed, pkg]) NodeFS.mkdirSync(path);
  const git = (...args) =>
    NodeChildProcess.execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "--quiet");
  git("config", "user.name", "Linux recovery fixture");
  git("config", "user.email", "linux-recovery@example.invalid");
  NodeFS.mkdirSync(NodePath.join(repo, "apps/server"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(repo, "apps/server/source.txt"), "delivered application\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "Delivered source");
  const source = git("rev-parse", "HEAD").trim();
  git("tag", nightly);
  NodeFS.writeFileSync(NodePath.join(repo, ".gitmodules"), "# checkout metadata\n");
  if (input.changedApplication)
    NodeFS.appendFileSync(NodePath.join(repo, "apps/server/source.txt"), "changed application\n");
  if (input.changedDependencies)
    NodeFS.writeFileSync(NodePath.join(repo, "pnpm-lock.yaml"), "changed dependencies\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "Recovery checkout fix");
  if (input.unstagedApplication || input.stagedApplication || input.indexOnlyApplication) {
    NodeFS.appendFileSync(NodePath.join(repo, "apps/server/source.txt"), "dirty application\n");
    if (input.stagedApplication || input.indexOnlyApplication) git("add", "apps/server/source.txt");
    if (input.indexOnlyApplication)
      NodeFS.writeFileSync(
        NodePath.join(repo, "apps/server/source.txt"),
        "delivered application\n",
      );
  }
  NodeFS.writeFileSync(
    NodePath.join(pkg, "package.json"),
    JSON.stringify({ name: "t3", version: input.packageVersion ?? version }),
  );
  const archive = NodePath.join(feed, `t3-${version}.tgz`);
  NodeChildProcess.execFileSync("tar", ["-czf", archive, "package/package.json"], { cwd: temp });
  const sha = NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(archive)).digest("hex");
  if (input.changedArchive) NodeFS.appendFileSync(archive, "corrupt archive bytes");
  NodeFS.writeFileSync(`${archive}.sha256`, `${sha}  t3-${version}.tgz\n`);
  NodeFS.writeFileSync(
    NodePath.join(feed, "latest-mac.yml"),
    `version: '${input.macVersion ?? version}'\n`,
  );
  NodeFS.writeFileSync(
    NodePath.join(feed, "latest-linux.yml"),
    `version: ${input.linuxVersion ?? "0.0.46-nightly.20261004.2657003185"}\n`,
  );
  NodeFS.writeFileSync(
    NodePath.join(bin, "curl"),
    `#!/bin/bash
set -euo pipefail
out=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    --max-time|--max-filesize) shift 2 ;;
    --*) shift ;;
    *) url="$1"; shift ;;
  esac
done
cp "$RECOVERY_FIXTURE_FEED/\${url##*/}" "$out"
`,
  );
  NodeFS.chmodSync(NodePath.join(bin, "curl"), 0o755);
  return {
    run() {
      return NodeChildProcess.spawnSync(
        "bash",
        [
          "-c",
          'set -euo pipefail; source "$1"; source "$2"; recovered="$(t3_resolve_linux_recovery_version)"; printf "%s\\n" "$recovered"',
          "fixture",
          NodePath.join(root, "scripts/fork/update-feed-version.sh"),
          NodePath.join(root, "scripts/fork/linux-recovery-version.sh"),
        ],
        {
          cwd: repo,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            RECOVERY_FIXTURE_FEED: feed,
            T3CODE_LINUX_RECOVERY_VERSION: input.requestedVersion ?? version,
            T3CODE_LINUX_RECOVERY_SOURCE_COMMIT: input.sourceCommit ?? source,
            T3CODE_LINUX_RECOVERY_CLI_SHA256: input.cliSha ?? sha,
            SYNC_TARGET_UPSTREAM_TAG: nightly,
            T3CODE_DESKTOP_UPDATE_FEED_URL: "https://release-fixture.example.invalid",
          },
        },
      );
    },
    remove() {
      NodeFS.rmSync(temp, { recursive: true, force: true });
    },
  };
}

describe("Linux recovery uses the delivered CLI version", () => {
  it("accepts identical application source and a verified matching Mac/CLI release", () => {
    const f = fixture();
    try {
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), version);
    } finally {
      f.remove();
    }
  });
  it.each([
    ["changed application source", { changedApplication: true }],
    ["changed dependencies", { changedDependencies: true }],
    ["unstaged application changes", { unstagedApplication: true }],
    ["staged application changes", { stagedApplication: true }],
    ["index changes hidden by a clean worktree", { indexOnlyApplication: true }],
    ["unrelated source commit", { sourceCommit: "0".repeat(40) }],
    ["different nightly family", { requestedVersion: "0.0.46-nightly.20261005.2703003200" }],
    ["different Mac release", { macVersion: "0.0.46-nightly.20261005.2702003201" }],
    ["already delivered Linux version", { linuxVersion: version }],
    ["Linux version downgrade", { linuxVersion: "0.0.47-nightly.20261005.1" }],
    ["changed CLI checksum", { cliSha: "0".repeat(64) }],
    ["changed CLI archive bytes", { changedArchive: true }],
    ["mismatched CLI package version", { packageVersion: "0.0.0" }],
  ])("rejects %s", (_name, input) => {
    const f = fixture(input);
    try {
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.notInclude(result.stdout, version);
    } finally {
      f.remove();
    }
  });
});
