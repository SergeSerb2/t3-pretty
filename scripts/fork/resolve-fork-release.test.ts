// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";

const scriptPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "resolve-fork-release.mjs",
);

function git(cwd: string, ...args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

it("emits a fork-specific semver tag that electron-updater can match to nightly", () => {
  const fixtureRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fork-release-"));

  try {
    git(fixtureRoot, "init");
    git(fixtureRoot, "config", "user.name", "T3 Fork Release Test");
    git(fixtureRoot, "config", "user.email", "t3-fork-release-test@example.invalid");
    NodeFS.writeFileSync(NodePath.join(fixtureRoot, "fixture.txt"), "fixture\n");
    git(fixtureRoot, "add", "fixture.txt");
    git(fixtureRoot, "commit", "-m", "test fixture");
    git(fixtureRoot, "tag", "v0.0.33-nightly.20260809.1043");

    const output = NodeChildProcess.execFileSync(process.execPath, [scriptPath], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: { ...process.env, GITHUB_RUN_NUMBER: "15", GITHUB_OUTPUT: "" },
    });
    const metadata = JSON.parse(output) as {
      readonly version: string;
      readonly tag: string;
      readonly upstream_tag: string;
    };

    assert.equal(metadata.version, "0.0.33-nightly.20260809.1043000015");
    assert.equal(metadata.tag, "v0.0.33-nightly.20260809.1043000015.fork");
    assert.equal(metadata.upstream_tag, "v0.0.33-nightly.20260809.1043");
    assert.match(metadata.tag, /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+\.fork$/u);
  } finally {
    NodeFS.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
