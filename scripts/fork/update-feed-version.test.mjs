import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const helper = NodePath.resolve(here, "update-feed-version.sh");
const linux = NodeFS.readFileSync(NodePath.resolve(here, "build-linux-appimage.sh"), "utf8");
const publishCli = NodeFS.readFileSync(NodePath.resolve(here, "publish-cli.sh"), "utf8");

function run(args, env = {}) {
  return NodeChildProcess.spawnSync("bash", [helper, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
}

function writeManifest(dir, name, versionLine) {
  NodeFS.writeFileSync(
    NodePath.join(dir, name),
    `${versionLine}
files:
  - url: T3-Code-fixture.AppImage
    sha512: fixture
    size: 1
releaseDate: '2026-09-23T21:06:13.686Z'
`,
  );
}

describe("update-feed-version", () => {
  it("is used by the Linux AppImage floor and CLI feed readers", () => {
    assert.include(linux, "update-feed-version.sh");
    assert.include(linux, "t3_resolve_update_feed_floor");
    assert.include(linux, "T3_FORK_BUILD_FLOOR");
    assert.notInclude(linux, "feed_version=\"${feed_version#");
    assert.include(publishCli, "update-feed-version.sh");
    assert.include(publishCli, "t3_read_update_manifest_version");
    assert.notInclude(publishCli, "feed_version=\"${feed_version#");
  });

  it("unwraps the live Mac single-quoted nightly and keeps Windows unquoted", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-feed-version-"));
    try {
      const mac = NodePath.join(dir, "latest-mac.yml");
      NodeFS.writeFileSync(
        mac,
        "version: '0.0.43-nightly.20260923.2150002803'\nfiles:\n  - url: T3-Code.dmg\n",
      );
      const win = NodePath.join(dir, "latest.yml");
      NodeFS.writeFileSync(win, "version: 0.0.43-nightly.20260923.2150002803\n");
      const quoted = run(["--print-version", mac]);
      assert.equal(quoted.status, 0, quoted.stderr);
      assert.equal(quoted.stdout.trim(), "0.0.43-nightly.20260923.2150002803");
      const unquoted = run(["--print-version", win]);
      assert.equal(unquoted.status, 0, unquoted.stderr);
      assert.equal(unquoted.stdout.trim(), "0.0.43-nightly.20260923.2150002803");
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("floors against the current Mac/Windows slot when Linux is behind", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-feed-floor-"));
    try {
      writeManifest(dir, "latest-mac.yml", "version: '0.0.43-nightly.20260923.2150002803'");
      writeManifest(dir, "latest.yml", "version: 0.0.43-nightly.20260923.2150002803");
      writeManifest(dir, "latest-linux.yml", "version: 0.0.43-nightly.20260922.2123002775");
      const result = run(["--dir", dir]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), "2150002803");
      assert.equal(result.stderr, "");
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts double-quoted YAML and CRLF the way electron-builder may emit", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-feed-quotes-"));
    try {
      NodeFS.writeFileSync(
        NodePath.join(dir, "latest-mac.yml"),
        'version: "0.0.43-nightly.20260923.2150002801"\r\n',
      );
      const printed = run(["--print-version", NodePath.join(dir, "latest-mac.yml")]);
      assert.equal(printed.status, 0, printed.stderr);
      assert.equal(printed.stdout.trim(), "0.0.43-nightly.20260923.2150002801");
      writeManifest(dir, "latest.yml", "version: '0.0.43-nightly.20260923.2150002801'");
      const floor = run(["--dir", dir]);
      assert.equal(floor.status, 0, floor.stderr);
      assert.equal(floor.stdout.trim(), "2150002801");
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unescapes YAML single-quoted apostrophes", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-feed-escape-"));
    try {
      const file = NodePath.join(dir, "latest.yml");
      NodeFS.writeFileSync(file, "version: 'it''s-nightly.20260923.1'\n");
      const printed = run(["--print-version", file]);
      assert.equal(printed.status, 0, printed.stderr);
      assert.equal(printed.stdout.trim(), "it's-nightly.20260923.1");
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a reachable manifest whose version is still quoted or not nightly", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-feed-refuse-"));
    try {
      writeManifest(dir, "latest-mac.yml", "version: 1.2.3");
      const result = run(["--dir", dir]);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /latest-mac\.yml version '1\.2\.3' is not a nightly build id/u,
      );
      assert.equal(/''1\.2\.3''/u.test(result.stderr), false);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips missing feeds and prints nothing when none have published", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-feed-empty-"));
    try {
      const result = run(["--dir", dir]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "");
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
