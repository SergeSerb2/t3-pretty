// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

import { verifyUpdateManifestAssets } from "./verify-update-manifest-assets.ts";

function writeFixture(root: string, fileName: string, contents: string): string {
  const filePath = NodePath.join(root, fileName);
  NodeFS.writeFileSync(filePath, contents);
  return filePath;
}

it("verifies updater payload size, digest, version, and required architecture", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-update-assets-"));
  try {
    const fileName = "T3-Code-1.2.3-arm64.zip";
    const contents = "signed updater fixture";
    writeFixture(root, fileName, contents);
    const digest = NodeCrypto.createHash("sha512").update(contents).digest("base64");
    const manifestPath = writeFixture(
      root,
      "latest-mac.yml",
      `version: 1.2.3
files:
  - url: ${fileName}
    sha512: ${digest}
    size: ${Buffer.byteLength(contents)}
releaseDate: '2026-08-23T00:00:00.000Z'
`,
    );

    const result = verifyUpdateManifestAssets({
      assetRoot: root,
      expectedVersion: "1.2.3",
      manifestPath,
      platformLabel: "macOS",
      requiredAssetSuffixes: ["-arm64.zip"],
    });
    assert.equal(result.manifest.files[0]?.url, fileName);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("rejects a payload whose bytes do not match the manifest digest", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-update-assets-"));
  try {
    const fileName = "T3-Code-1.2.3-x64.exe";
    const contents = "installer fixture";
    writeFixture(root, fileName, contents);
    const manifestPath = writeFixture(
      root,
      "latest.yml",
      `version: 1.2.3
files:
  - url: ${fileName}
    sha512: ${"A".repeat(86)}==
    size: ${Buffer.byteLength(contents)}
releaseDate: '2026-08-23T00:00:00.000Z'
`,
    );

    assert.throws(
      () =>
        verifyUpdateManifestAssets({
          assetRoot: root,
          expectedVersion: "1.2.3",
          manifestPath,
          platformLabel: "Windows",
          requiredAssetSuffixes: ["-x64.exe"],
        }),
      /checksum does not match/u,
    );
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
