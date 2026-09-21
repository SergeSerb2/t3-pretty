// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  parseUpdateManifest,
  type UpdateManifest,
  UPDATE_MANIFEST_TEXT_BYTE_LIMIT,
} from "./update-manifest.ts";

export const UPDATE_MANIFEST_BYTE_LIMIT = UPDATE_MANIFEST_TEXT_BYTE_LIMIT;
export const UPDATE_MANIFEST_FILE_LIMIT = 16;

export interface VerifiedUpdateManifest {
  readonly path: string;
  readonly manifest: UpdateManifest;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

export function readBoundedUpdateManifestFile(filePath: string): Buffer {
  const handle = NodeFS.openSync(
    filePath,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = NodeFS.fstatSync(handle);
    if (!metadata.isFile() || metadata.size > UPDATE_MANIFEST_BYTE_LIMIT) {
      throw new Error("Update manifest is not a bounded regular file.");
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const bytesRead = NodeFS.readSync(handle, buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > UPDATE_MANIFEST_BYTE_LIMIT) {
        throw new Error("Update manifest exceeds its byte limit.");
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    NodeFS.closeSync(handle);
  }
}

function verifyAssetDigest(assetPath: string, expectedSize: number, expectedSha512: string): void {
  const handle = NodeFS.openSync(
    assetPath,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = NodeFS.fstatSync(handle);
    if (!metadata.isFile() || metadata.size !== expectedSize) {
      throw new Error("Updater asset size does not match its manifest.");
    }

    const hash = NodeCrypto.createHash("sha512");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const bytesRead = NodeFS.readSync(handle, buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (hash.digest("base64") !== expectedSha512) {
      throw new Error("Updater asset checksum does not match its manifest.");
    }
  } finally {
    NodeFS.closeSync(handle);
  }
}

export function verifyUpdateManifestAssets(options: {
  readonly assetRoot: string;
  readonly expectedVersion: string;
  readonly manifestPath: string;
  readonly platformLabel: string;
  readonly requiredAssetSuffixes: ReadonlyArray<string>;
}): VerifiedUpdateManifest {
  const assetRoot = NodePath.resolve(options.assetRoot);
  const manifestPath = NodePath.resolve(options.manifestPath);
  const raw = readBoundedUpdateManifestFile(manifestPath).toString("utf8");
  const manifest = parseUpdateManifest(raw, manifestPath, options.platformLabel);

  if (
    !manifest.version ||
    Buffer.byteLength(manifest.version, "utf8") > 128 ||
    hasControlCharacter(manifest.version) ||
    manifest.version !== options.expectedVersion
  ) {
    throw new Error(`${options.platformLabel} updater manifest has an invalid release version.`);
  }
  if (manifest.files.length > UPDATE_MANIFEST_FILE_LIMIT) {
    throw new Error(`${options.platformLabel} updater manifest has too many file entries.`);
  }

  const seenAssetNames = new Set<string>();
  for (const file of manifest.files) {
    if (
      !file.url ||
      Buffer.byteLength(file.url, "utf8") > 255 ||
      file.url !== NodePath.basename(file.url) ||
      file.url === "." ||
      file.url === ".." ||
      /[\\/]/u.test(file.url) ||
      hasControlCharacter(file.url) ||
      seenAssetNames.has(file.url)
    ) {
      throw new Error(`${options.platformLabel} updater manifest has an unsafe asset name.`);
    }
    seenAssetNames.add(file.url);
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error(`${options.platformLabel} updater manifest has an invalid asset size.`);
    }
    if (!/^[A-Za-z0-9+/]{86}==$/u.test(file.sha512)) {
      throw new Error(`${options.platformLabel} updater manifest has an invalid SHA-512 digest.`);
    }
    verifyAssetDigest(NodePath.join(assetRoot, file.url), file.size, file.sha512);
  }

  for (const suffix of options.requiredAssetSuffixes) {
    if (!manifest.files.some((file) => file.url.endsWith(suffix))) {
      throw new Error(
        `${options.platformLabel} updater manifest is missing a required '${suffix}' asset.`,
      );
    }
  }

  return { path: manifestPath, manifest };
}
