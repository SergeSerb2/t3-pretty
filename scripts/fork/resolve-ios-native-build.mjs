#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import {
  classifyCloudBuildStatus,
  inflightAsBuild,
  inflightMatchesFingerprint,
  parseInflightRecord,
} from "./eas-cloud-build.mjs";

// `eas fingerprint:generate --json` lists every native source it hashed; on
// this app that runs well past 64 KiB, and a 64 KiB cap failed every
// TestFlight job. The dump gets a bound a fingerprint cannot reach; the
// submitted-fingerprint marker holds one hash and keeps the tight one.
const MAX_FINGERPRINT_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_MARKER_INPUT_BYTES = 64 * 1024;
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

function readBoundedFile(path, label, limit = MAX_FINGERPRINT_INPUT_BYTES) {
  const file = NodeFS.openSync(path, "r");
  try {
    if (NodeFS.fstatSync(file).size > limit) {
      throw new Error(`${label} exceeded the ${limit}-byte safety limit.`);
    }
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const read = NodeFS.readSync(file, bytes, length, bytes.byteLength - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > limit) {
      throw new Error(`${label} exceeded the ${limit}-byte safety limit.`);
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
      readBoundedFile(
        args.get("submitted-fingerprint-file"),
        "Submitted fingerprint file",
        MAX_MARKER_INPUT_BYTES,
      ),
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

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function asBuildList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.builds)) return value.builds;
    if (Array.isArray(value.currentPage)) return value.currentPage;
    if (nonEmptyString(value.id)) return [value];
  }
  return [];
}

export function buildRuntimeVersion(build) {
  const fingerprint = build?.fingerprint;
  return (
    nonEmptyString(build?.runtimeVersion) ||
    nonEmptyString(fingerprint?.hash) ||
    nonEmptyString(fingerprint) ||
    nonEmptyString(build?.metadata?.runtimeVersion) ||
    nonEmptyString(build?.metadata?.fingerprintHash) ||
    nonEmptyString(build?.metadata?.fingerprint)
  );
}

export function archiveUrlFor(build) {
  return (
    nonEmptyString(build?.artifacts?.applicationArchiveUrl) ||
    nonEmptyString(build?.artifacts?.buildUrl)
  );
}

function isProductionIosBuild(build) {
  if (!build || typeof build !== "object") return false;
  if (!nonEmptyString(build.id)) return false;
  const platform = nonEmptyString(build.platform || build.appPlatform).toUpperCase();
  if (platform && platform !== "IOS") return false;
  const profile = nonEmptyString(build.buildProfile || build.profile);
  if (profile && profile !== "production") return false;
  return true;
}

export function isFinishedProductionIosBuild(build) {
  if (!isProductionIosBuild(build)) return false;
  return classifyCloudBuildStatus(build.status) === "finished";
}

export function isActiveProductionIosBuild(build) {
  if (!isProductionIosBuild(build)) return false;
  const kind = classifyCloudBuildStatus(build.status);
  // Unknown / empty / new Expo states are in-flight-ish. A matching
  // fingerprint with an id must reattach; only a failed compile is a miss.
  return kind === "active" || kind === "unknown";
}

function emptyReusableCloudIpa() {
  return { reuseBuildId: "", reuseArtifactUrl: "", reuseStatus: "" };
}

// A hosted IPA is not TestFlight delivery proof. A finished matching cloud
// binary can be downloaded, and an in-flight or unknown-status matching
// one can be reattached, without spending another Expo credit. Only a
// failed compile or a missing id starts a new IPA. Only the marker
// written after `eas submit` succeeds is allowed to skip the native job.
export function selectReusableCloudIpa(builds, fingerprint) {
  const expected = nonEmptyString(fingerprint);
  if (!expected) return emptyReusableCloudIpa();
  const list = asBuildList(builds);
  const finished = list.find(
    (build) => isFinishedProductionIosBuild(build) && buildRuntimeVersion(build) === expected,
  );
  if (finished) {
    return {
      reuseBuildId: nonEmptyString(finished.id),
      reuseArtifactUrl: archiveUrlFor(finished),
      reuseStatus: "finished",
    };
  }
  const active = list.find(
    (build) => isActiveProductionIosBuild(build) && buildRuntimeVersion(build) === expected,
  );
  if (!active) return emptyReusableCloudIpa();
  return {
    reuseBuildId: nonEmptyString(active.id),
    reuseArtifactUrl: archiveUrlFor(active),
    reuseStatus: "active",
  };
}

function readBuilds(args) {
  try {
    if (args.has("builds-file")) {
      const raw = readBoundedFile(args.get("builds-file"), "Builds file").trim();
      if (!raw) return [];
      return asBuildList(readJson(raw, "builds file"));
    }
    if (args.has("builds-json")) {
      const raw = args.get("builds-json") ?? "";
      if (!raw.trim()) return [];
      return asBuildList(readJson(raw, "builds JSON"));
    }
  } catch {
    return [];
  }
  return [];
}

function readInflightBuilds(args, fingerprint) {
  if (!args.has("inflight-file")) return [];
  try {
    const raw = readBoundedFile(
      args.get("inflight-file"),
      "In-flight EAS file",
      MAX_MARKER_INPUT_BYTES,
    );
    if (!raw.trim()) return [];
    const record = parseInflightRecord(raw);
    if (!inflightMatchesFingerprint(record, fingerprint)) return [];
    return [inflightAsBuild(record)];
  } catch {
    return [];
  }
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    // An empty string is a real value (`--submitted-fingerprint ""`). Treat only
    // a missing argv slot or another `--flag` as a boolean switch.
    if (next !== undefined && !next.startsWith("--")) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, "true");
    }
  }
  return args;
}

export function resolveNativeBuild(argv = NodeProcess.argv.slice(2), env = NodeProcess.env) {
  const args = parseArgs(argv);
  const fingerprint = readFingerprintInput(args);
  const platform = args.get("platform") === "android" ? "Android" : "iOS";
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
  // succeeds is allowed to suppress a local release build. An in-flight or
  // finished matching cloud IPA can still be reused so a retry does not spend
  // another Expo credit (BK #2922).
  const shouldBuild = forceBuild || submittedFingerprint !== fingerprint;
  const hostedBuilds = [...readInflightBuilds(args, fingerprint), ...readBuilds(args)];
  const reusable = shouldBuild
    ? selectReusableCloudIpa(hostedBuilds, fingerprint)
    : emptyReusableCloudIpa();

  const outputPath = args.get("github-output") || env.GITHUB_OUTPUT;
  const lines = [
    `fingerprint=${fingerprint}`,
    `last_runtime_version=${submittedFingerprint}`,
    `submitted_fingerprint=${submittedFingerprint}`,
    `should_build=${shouldBuild ? "true" : "false"}`,
    `reuse_build_id=${reusable.reuseBuildId}`,
    `reuse_artifact_url=${reusable.reuseArtifactUrl}`,
    `reuse_status=${reusable.reuseStatus}`,
  ];

  if (outputPath) {
    NodeFS.appendFileSync(outputPath, `${lines.join("\n")}\n`);
  }

  let stdout = `${lines.join("\n")}\n`;
  if (forceBuild) {
    stdout += `Forcing a native ${platform} build (mode=build).\n`;
  } else if (shouldBuild) {
    stdout += `${platform} runtime fingerprint changed (${submittedFingerprint || "none"} -> ${fingerprint}).\n`;
    if (reusable.reuseStatus === "finished") {
      stdout += `Reusing finished EAS cloud IPA ${reusable.reuseBuildId}; not spending another Expo build credit.\n`;
    } else if (reusable.reuseBuildId) {
      stdout += `Reattaching to in-flight EAS cloud IPA ${reusable.reuseBuildId}; not spending another Expo build credit.\n`;
    }
  } else {
    stdout += `${platform} runtime fingerprint ${fingerprint} already has a production binary; skipping native build.\n`;
  }
  return stdout;
}

function main() {
  NodeProcess.stdout.write(resolveNativeBuild());
}

const invokedAsMain =
  Boolean(NodeProcess.argv[1]) &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(NodeProcess.argv[1])).href;
if (invokedAsMain) {
  main();
}
