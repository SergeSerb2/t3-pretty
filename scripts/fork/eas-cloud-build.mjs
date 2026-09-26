#!/usr/bin/env node
// Shared EAS cloud-IPA helpers for tip packaging. `eas build --wait` held
// the windows-release agent for the whole Expo compile; when that host
// dropped (BK #2922) the job died with exit -1 even though the IPA was
// already submitted. Create is --no-wait, the id is persisted, and a later
// ios-mobile run reattaches. Real ERRORED/CANCELED compiles still fail.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

// Expo cloud iOS production compiles commonly take 20–45 minutes plus
// queue. 60 minutes keeps a healthy windows-release agent attached
// through a typical IPA (ios-mobile's job timeout is 90 minutes, so
// OTA + TestFlight still have room). Override with
// T3CODE_IOS_EAS_WAIT_SECONDS for short agent-loss experiments.
export const DEFAULT_EAS_WAIT_SECONDS = 3600;
export const BUILD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function isBuildId(value) {
  return BUILD_ID_PATTERN.test(nonEmptyString(value));
}

export function classifyCloudBuildStatus(status) {
  const normalized = nonEmptyString(status).toLowerCase().replace(/_/gu, "-");
  if (normalized === "finished" || normalized === "complete" || normalized === "completed") {
    return "finished";
  }
  if (
    normalized === "errored" ||
    normalized === "error" ||
    normalized === "failed" ||
    normalized === "canceled" ||
    normalized === "cancelled"
  ) {
    return "failed";
  }
  if (
    normalized === "new" ||
    normalized === "in-queue" ||
    normalized === "in-progress" ||
    normalized === "pending" ||
    normalized === "queued" ||
    normalized === "waiting"
  ) {
    return "active";
  }
  return "unknown";
}

export function archiveUrlFor(build) {
  return (
    nonEmptyString(build?.artifacts?.applicationArchiveUrl) ||
    nonEmptyString(build?.artifacts?.buildUrl)
  );
}

export function buildNumberOf(build) {
  return (
    nonEmptyString(build?.appBuildVersion) ||
    nonEmptyString(build?.metadata?.appBuildVersion) ||
    nonEmptyString(build?.metadata?.buildNumber) ||
    nonEmptyString(build?.buildNumber)
  );
}

export function fingerprintOf(build) {
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

export function extractJsonValues(raw) {
  const text = String(raw ?? "");
  const values = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{" && text[start] !== "[") continue;
    const stack = [];
    let inString = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const character = text[end];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        stack.push("}");
      } else if (character === "[") {
        stack.push("]");
      } else if (character === "}" || character === "]") {
        if (stack.pop() !== character) break;
        if (stack.length === 0) {
          let parsed = false;
          try {
            values.push(JSON.parse(text.slice(start, end + 1)));
            parsed = true;
          } catch {
            // A non-JSON progress fragment may wrap later JSON.
          }
          if (parsed) start = end;
          break;
        }
      }
    }
  }
  return values;
}

export function flattenBuildCandidates(values) {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.builds)) return value.builds;
    if (Array.isArray(value?.currentPage)) return value.currentPage;
    return [value];
  });
}

export function pickCloudBuild(raw, { requireArchive = false } = {}) {
  const candidates = flattenBuildCandidates(extractJsonValues(raw));
  return (
    [...candidates].reverse().find((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      if (!nonEmptyString(candidate.id)) return false;
      if (requireArchive && !archiveUrlFor(candidate)) return false;
      return true;
    }) ?? null
  );
}

export function formatCloudBuildState(build) {
  const status = nonEmptyString(build?.status);
  return [
    `id=${nonEmptyString(build?.id)}`,
    `status=${status}`,
    `kind=${classifyCloudBuildStatus(status)}`,
    `artifact_url=${archiveUrlFor(build)}`,
    `build_number=${buildNumberOf(build)}`,
    `fingerprint=${fingerprintOf(build)}`,
  ].join("\n");
}

export function parseInflightRecord(text) {
  const record = {
    id: "",
    fingerprint: "",
    commit: "",
    buildNumber: "",
    status: "",
  };
  for (const line of String(text ?? "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key === "id") record.id = value;
    if (key === "fingerprint") record.fingerprint = value;
    if (key === "commit") record.commit = value;
    if (key === "buildNumber" || key === "build_number") record.buildNumber = value;
    if (key === "status") record.status = value;
  }
  if (!isBuildId(record.id)) {
    throw new Error("In-flight EAS record is missing a build id.");
  }
  return record;
}

export function formatInflightRecord({
  id,
  fingerprint = "",
  commit = "",
  buildNumber = "",
  status = "in-progress",
} = {}) {
  if (!isBuildId(id)) {
    throw new Error("In-flight EAS record requires a UUID build id.");
  }
  return [
    `id=${nonEmptyString(id)}`,
    `fingerprint=${nonEmptyString(fingerprint)}`,
    `commit=${nonEmptyString(commit)}`,
    `buildNumber=${nonEmptyString(buildNumber)}`,
    `status=${nonEmptyString(status) || "in-progress"}`,
  ].join("\n");
}

export function inflightMatchesFingerprint(record, fingerprint) {
  const expected = nonEmptyString(fingerprint);
  const actual = nonEmptyString(record?.fingerprint);
  return Boolean(expected && actual && expected === actual && isBuildId(record?.id));
}

export function inflightAsBuild(record) {
  return {
    id: nonEmptyString(record?.id),
    platform: "IOS",
    buildProfile: "production",
    status: nonEmptyString(record?.status) || "in-progress",
    runtimeVersion: nonEmptyString(record?.fingerprint),
    metadata: {
      appBuildVersion: nonEmptyString(record?.buildNumber),
    },
  };
}

export function waitOutcome({ kind = "unknown", interrupted = false, timedOut = false } = {}) {
  if (kind === "failed") return "fail";
  if (kind === "finished") return "continue";
  if (interrupted || timedOut) return "soft-exit";
  return "poll";
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, "true");
    }
  }
  return args;
}

function truthy(value) {
  return value === "true" || value === "1" || value === "yes";
}

export function runCli(argv = NodeProcess.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.has("read-json")) {
    const raw = NodeFS.readFileSync(args.get("read-json"), "utf8");
    const build = pickCloudBuild(raw, { requireArchive: args.get("require-archive") === "true" });
    return `${formatCloudBuildState(build)}\n`;
  }
  if (args.has("write-inflight")) {
    const path = args.get("write-inflight");
    const record = formatInflightRecord({
      id: args.get("id"),
      fingerprint: args.get("fingerprint"),
      commit: args.get("commit"),
      buildNumber: args.get("build-number"),
      status: args.get("status"),
    });
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.writeFileSync(path, `${record}\n`);
    return "";
  }
  if (args.has("read-inflight")) {
    const record = parseInflightRecord(NodeFS.readFileSync(args.get("read-inflight"), "utf8"));
    return `${formatInflightRecord(record)}\n`;
  }
  if (args.has("wait-outcome")) {
    return `${waitOutcome({
      kind: args.get("kind") || "unknown",
      interrupted: truthy(args.get("interrupted")),
      timedOut: truthy(args.get("timed-out")),
    })}\n`;
  }
  throw new Error(
    "eas-cloud-build.mjs expected --read-json, --write-inflight, --read-inflight, or --wait-outcome.",
  );
}

function main() {
  NodeProcess.stdout.write(runCli());
}

const invokedAsMain =
  Boolean(NodeProcess.argv[1]) &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(NodeProcess.argv[1])).href;
if (invokedAsMain) {
  main();
}
