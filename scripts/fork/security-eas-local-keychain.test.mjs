import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const wrapperPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "security-eas-local-keychain",
);

function run(args) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-security-shim-"));
  const fakeSecurity = NodePath.join(directory, "fake-security");
  NodeFS.writeFileSync(
    fakeSecurity,
    `#!/usr/bin/env bash
printf '%s\\n' "$*"
`,
  );
  NodeFS.chmodSync(fakeSecurity, 0o755);
  const wrapperCopy = NodePath.join(directory, "security-eas-local-keychain");
  NodeFS.writeFileSync(
    wrapperCopy,
    NodeFS.readFileSync(wrapperPath, "utf8").replace(
      'real="/usr/bin/security"',
      `real=${JSON.stringify(fakeSecurity)}`,
    ),
  );
  NodeFS.chmodSync(wrapperCopy, 0o755);
  return NodeChildProcess.execFileSync(wrapperCopy, args, {
    encoding: "utf8",
    env: process.env,
  });
}

describe("EAS local-build security shim", () => {
  it("drops -v for find-identity against an EAS temp keychain", () => {
    const output = run([
      "find-identity",
      "-v",
      "-s",
      "(78A5P57U23)",
      "/tmp/eas-build-b5923657-f790-4f2b-87c3-837cbefe3d52.keychain",
    ]);

    assert.equal(
      output.trim(),
      "find-identity -s (78A5P57U23) /tmp/eas-build-b5923657-f790-4f2b-87c3-837cbefe3d52.keychain",
    );
  });

  it("leaves other security commands and keychains unchanged", () => {
    const output = run(["find-identity", "-v", "-p", "codesigning", "login.keychain-db"]);

    assert.equal(output.trim(), "find-identity -v -p codesigning login.keychain-db");
  });
});
