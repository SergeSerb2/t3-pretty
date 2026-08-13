#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodeProcess from "node:process";

function readJson(value, label) {
  if (!value || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label}: ${detail}`);
  }
}

function fingerprintHash(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.hash === "string") {
    return value.hash.trim();
  }
  throw new Error("Fingerprint JSON did not contain a hash.");
}

function readFingerprintInput(args) {
  if (args.has("fingerprint-file")) {
    const path = args.get("fingerprint-file");
    const source = NodeFS.readFileSync(path, "utf8").trim();
    if (source.startsWith("{") || source.startsWith("[")) {
      return fingerprintHash(readJson(source, "fingerprint file"));
    }
    const lastToken = source.split(/\s+/u).filter(Boolean).at(-1);
    if (lastToken) return lastToken;
    throw new Error(`Fingerprint file '${path}' was empty.`);
  }
  return fingerprintHash(readJson(args.get("fingerprint-json") ?? "", "fingerprint JSON"));
}

function asBuildList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.builds)) return value.builds;
  if (Array.isArray(value.data)) return value.data;
  return [];
}

function readBuildList(args) {
  try {
    if (args.has("builds-file")) {
      const path = args.get("builds-file");
      return asBuildList(readJson(NodeFS.readFileSync(path, "utf8"), "EAS build list file") ?? []);
    }
    return asBuildList(readJson(args.get("builds-json") ?? "[]", "EAS build list JSON") ?? []);
  } catch {
    return [];
  }
}

function runtimeVersionOf(build) {
  if (!build || typeof build !== "object") return "";
  for (const key of ["runtimeVersion", "runtime_version", "fingerprintHash", "fingerprint_hash"]) {
    const value = build[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const fingerprint = build.fingerprint;
  if (fingerprint && typeof fingerprint === "object" && typeof fingerprint.hash === "string") {
    return fingerprint.hash.trim();
  }
  return "";
}

function isIosProductionBuild(build) {
  if (!build || typeof build !== "object") return false;
  const platform = String(build.platform ?? build.appPlatform ?? "").toUpperCase();
  if (platform && platform !== "IOS") return false;
  const profile = String(build.buildProfile ?? build.profile ?? "").toLowerCase();
  return !profile || profile === "production";
}

const args = new Map();
for (let index = 2; index < NodeProcess.argv.length; index += 1) {
  const arg = NodeProcess.argv[index];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = NodeProcess.argv[index + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, "true");
  }
}

const fingerprint = readFingerprintInput(args);
const forceBuild = args.get("force") === "true" || args.get("force") === "1";
const builds = readBuildList(args);
// Local `eas build --local` binaries never appear in `eas build:list`. The
// workflow therefore also persists the last successfully submitted fingerprint
// (`.t3-fork/ios-production-fingerprint`) so JavaScript-only releases do not
// rebuild forever after the first local IPA.
const submittedFingerprint = (args.get("submitted-fingerprint") ?? "").trim();
const easRuntimeVersion = runtimeVersionOf(builds.find(isIosProductionBuild) ?? builds[0]);
const knownFingerprints = new Set(
  [easRuntimeVersion, submittedFingerprint].filter((value) => Boolean(value)),
);
const lastRuntimeVersion = submittedFingerprint || easRuntimeVersion;
const shouldBuild = forceBuild || !knownFingerprints.has(fingerprint);

const outputPath = args.get("github-output") || NodeProcess.env.GITHUB_OUTPUT;
const lines = [
  `fingerprint=${fingerprint}`,
  `last_runtime_version=${lastRuntimeVersion}`,
  `eas_runtime_version=${easRuntimeVersion}`,
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
    `iOS runtime fingerprint changed (${lastRuntimeVersion || "none"} -> ${fingerprint}).\n`,
  );
} else {
  NodeProcess.stdout.write(
    `iOS runtime fingerprint ${fingerprint} already has a production binary; skipping Xcode.\n`,
  );
}
