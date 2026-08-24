#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodeProcess from "node:process";

const MAX_FINGERPRINT_INPUT_BYTES = 64 * 1024;
const MAX_FINGERPRINT_BYTES = 512;

function readJson(value, label) {
  if (!value || !value.trim()) return null;
  if (Buffer.byteLength(value, "utf8") > MAX_FINGERPRINT_INPUT_BYTES) {
    throw new Error(`${label} exceeded the ${MAX_FINGERPRINT_INPUT_BYTES}-byte safety limit.`);
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label}: ${detail}`, { cause: error });
  }
}

function normalizeFingerprint(value, label, allowEmpty = false) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized && allowEmpty) return "";
  if (
    !normalized ||
    Buffer.byteLength(normalized, "utf8") > MAX_FINGERPRINT_BYTES ||
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
  ) {
    throw new Error(`${label} was empty, oversized, or contained a control character.`);
  }
  return normalized;
}

function fingerprintHash(value) {
  if (typeof value === "string") return normalizeFingerprint(value, "Fingerprint hash");
  if (value && typeof value === "object" && typeof value.hash === "string") {
    return normalizeFingerprint(value.hash, "Fingerprint hash");
  }
  throw new Error("Fingerprint JSON did not contain a hash.");
}

function readBoundedFile(path, label) {
  const file = NodeFS.openSync(path, "r");
  try {
    if (NodeFS.fstatSync(file).size > MAX_FINGERPRINT_INPUT_BYTES) {
      throw new Error(`${label} exceeded the ${MAX_FINGERPRINT_INPUT_BYTES}-byte safety limit.`);
    }
    const bytes = Buffer.alloc(MAX_FINGERPRINT_INPUT_BYTES + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const read = NodeFS.readSync(file, bytes, length, bytes.byteLength - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_FINGERPRINT_INPUT_BYTES) {
      throw new Error(`${label} exceeded the ${MAX_FINGERPRINT_INPUT_BYTES}-byte safety limit.`);
    }
    return bytes.subarray(0, length).toString("utf8");
  } finally {
    NodeFS.closeSync(file);
  }
}

function readFingerprintInput(args) {
  if (args.has("fingerprint-file")) {
    const path = args.get("fingerprint-file");
    const source = readBoundedFile(path, "Fingerprint file").trim();
    if (source.startsWith("{") || source.startsWith("[")) {
      return fingerprintHash(readJson(source, "fingerprint file"));
    }
    const lastToken = source.split(/\s+/u).findLast(Boolean);
    if (lastToken) return normalizeFingerprint(lastToken, "Fingerprint hash");
    throw new Error(`Fingerprint file '${path}' was empty.`);
  }
  return fingerprintHash(readJson(args.get("fingerprint-json") ?? "", "fingerprint JSON"));
}

function readSubmittedFingerprint(args) {
  if (args.has("submitted-fingerprint-file")) {
    return normalizeFingerprint(
      readBoundedFile(args.get("submitted-fingerprint-file"), "Submitted fingerprint file"),
      "Submitted fingerprint",
      true,
    );
  }
  return normalizeFingerprint(
    args.get("submitted-fingerprint") ?? "",
    "Submitted fingerprint",
    true,
  );
}

const args = new Map();
for (let index = 2; index < NodeProcess.argv.length; index += 1) {
  const arg = NodeProcess.argv[index];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = NodeProcess.argv[index + 1];
  // An empty string is a real value (`--submitted-fingerprint ""`). Treat only
  // a missing argv slot or another `--flag` as a boolean switch.
  if (next !== undefined && !next.startsWith("--")) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, "true");
  }
}

const fingerprint = readFingerprintInput(args);
const forceBuild = args.get("force") === "true" || args.get("force") === "1";
// Local `eas build --local` binaries never appear in `eas build:list`. The
// workflow therefore persists the last successfully submitted fingerprint
// (`.t3-fork/ios-production-fingerprint`). Automatic `release` skips Xcode
// when that hash still matches (OTA already shipped the JS). `--force` is
// reserved for explicit `build` / force_ios dispatches.
const submittedFingerprint = readSubmittedFingerprint(args);
// A hosted EAS build record proves only that an IPA was compiled. This fork has
// no hosted auto-submit path, so neither an in-flight nor a finished build can
// prove TestFlight delivery. Only the marker written after `eas submit`
// succeeds is allowed to suppress a local release build.
const shouldBuild = forceBuild || submittedFingerprint !== fingerprint;

const outputPath = args.get("github-output") || NodeProcess.env.GITHUB_OUTPUT;
const lines = [
  `fingerprint=${fingerprint}`,
  `last_runtime_version=${submittedFingerprint}`,
  `submitted_fingerprint=${submittedFingerprint}`,
  `should_build=${shouldBuild ? "true" : "false"}`,
];

if (outputPath) {
  NodeFS.appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

for (const line of lines) {
  NodeProcess.stdout.write(`${line}\n`);
}

if (forceBuild) {
  NodeProcess.stdout.write("Forcing a native iOS build (mode=build).\n");
} else if (shouldBuild) {
  NodeProcess.stdout.write(
    `iOS runtime fingerprint changed (${submittedFingerprint || "none"} -> ${fingerprint}).\n`,
  );
} else {
  NodeProcess.stdout.write(
    `iOS runtime fingerprint ${fingerprint} already has a production binary; skipping Xcode.\n`,
  );
}
