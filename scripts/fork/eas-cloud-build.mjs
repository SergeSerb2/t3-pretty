#!/usr/bin/env node
// Shared EAS cloud-IPA helpers for tip packaging. `eas build --wait` held
// the windows-release agent for the whole Expo compile; when that host
// dropped (BK #2922) the job died with exit -1 even though the IPA was
// already submitted. Create is --no-wait, the id is persisted, and a later
// ios-mobile run reattaches. Status comes from Expo GraphQL (EXPO_TOKEN)
// first; `eas build:view --json` is the fallback and must not pass
// `--non-interactive` (current eas-cli rejects that flag, BK #2925).
// Real ERRORED/CANCELED compiles still fail.
import * as NodeChildProcess from "node:child_process";
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
// When Expo never returns status, do not park windows-nsis behind a
// 60-minute unknown poll. Six 20s polls is about two minutes.
export const DEFAULT_EAS_VIEW_FAIL_POLLS = 6;
export const EXPO_GRAPHQL_URL = "https://api.expo.dev/graphql";
export const BUILD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
// Same constraint as `eas build:list --platform ios --distribution store`.
export const STORE_IOS_BUILD_FILTER = { platform: "IOS", distribution: "STORE" };

const BUILD_SELECTION = `
      id
      status
      platform
      buildProfile
      appBuildVersion
      distribution
      createdAt
      fingerprint { hash }
      runtime { version }
      artifacts {
        applicationArchiveUrl
        buildUrl
      }
      error {
        errorCode
        message
      }`;

export const BUILD_BY_ID_QUERY = `query T3PrettyEasCloudBuildById($buildId: ID!) {
  builds {
    byId(buildId: $buildId) {${BUILD_SELECTION}
    }
  }
}`;

export const BUILDS_ON_APP_QUERY = `query T3PrettyEasCloudBuildsOnApp(
  $appId: String!
  $offset: Int!
  $limit: Int!
  $filter: BuildFilter
) {
  app {
    byId(appId: $appId) {
      builds(offset: $offset, limit: $limit, filter: $filter) {${BUILD_SELECTION}
      }
    }
  }
}`;

export function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function isBuildId(value) {
  return BUILD_ID_PATTERN.test(nonEmptyString(value));
}

export function isStoreDistribution(build) {
  const distribution = nonEmptyString(build?.distribution).toLowerCase().replace(/_/gu, "-");
  return !distribution || distribution === "store";
}

export function isListedProductionStoreBuild(build) {
  if (!build || !nonEmptyString(build.id)) return false;
  const profile = nonEmptyString(build.buildProfile || build.profile);
  if (profile && profile !== "production") return false;
  return isStoreDistribution(build);
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
    normalized === "pending-cancel" ||
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
    nonEmptyString(build?.runtime?.version) ||
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

export function isStaleStatusRefresh({ viewFailures = 0, maxViewFailures = 0 } = {}) {
  return maxViewFailures > 0 && viewFailures >= maxViewFailures;
}

export function waitOutcome({
  kind = "unknown",
  interrupted = false,
  timedOut = false,
  viewFailures = 0,
  maxViewFailures = 0,
} = {}) {
  if (kind === "failed") return "fail";
  if (kind === "finished") return "continue";
  if (interrupted || timedOut || isStaleStatusRefresh({ viewFailures, maxViewFailures })) {
    return "soft-exit";
  }
  return "poll";
}

export function normalizeGraphQLBuild(build) {
  if (!build || typeof build !== "object") return null;
  const runtimeVersion =
    nonEmptyString(build.runtimeVersion) ||
    nonEmptyString(build.runtime?.version) ||
    nonEmptyString(build.fingerprint?.hash);
  return {
    ...build,
    runtimeVersion,
  };
}

export async function expoGraphql({
  token,
  query,
  variables,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!nonEmptyString(token)) {
    throw new Error("EXPO_TOKEN is required to query Expo GraphQL.");
  }
  const response = await fetchImpl(EXPO_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors?.length) {
    const message =
      body.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body.data;
}

export async function fetchCloudBuildById({ buildId, token, fetchImpl } = {}) {
  if (!isBuildId(buildId)) {
    throw new Error("EAS cloud build view requires a UUID build id.");
  }
  const data = await expoGraphql({
    token,
    query: BUILD_BY_ID_QUERY,
    variables: { buildId },
    fetchImpl,
  });
  const build = normalizeGraphQLBuild(data?.builds?.byId);
  if (!build || !nonEmptyString(build.id)) {
    throw new Error(`Expo GraphQL returned no build for ${buildId}.`);
  }
  return build;
}

export async function fetchCloudBuildsViaGraphql({
  token,
  appId,
  limit = 20,
  offset = 0,
  fetchImpl,
} = {}) {
  if (!nonEmptyString(appId)) {
    throw new Error("Expo GraphQL build list requires an app id.");
  }
  const data = await expoGraphql({
    token,
    query: BUILDS_ON_APP_QUERY,
    variables: {
      appId,
      offset,
      limit,
      filter: STORE_IOS_BUILD_FILTER,
    },
    fetchImpl,
  });
  const rows = data?.app?.byId?.builds;
  if (!Array.isArray(rows)) {
    throw new Error(`Expo GraphQL returned no iOS builds for ${appId}.`);
  }
  return rows.map((row) => normalizeGraphQLBuild(row)).filter(isListedProductionStoreBuild);
}

function easExecutable(env = NodeProcess.env) {
  if (nonEmptyString(env.EAS_BIN)) return env.EAS_BIN;
  return NodeProcess.platform === "win32" ? "eas.cmd" : "eas";
}

export function runEas(args, { cwd, env = NodeProcess.env } = {}) {
  const result = NodeChildProcess.spawnSync(easExecutable(env), args, {
    cwd,
    encoding: "utf8",
    env: { ...env, CI: env.CI || "1" },
    windowsHide: true,
    // win32 needs the cmd shim; a test-injected EAS_BIN is a real executable.
    shell: NodeProcess.platform === "win32" && !nonEmptyString(env.EAS_BIN),
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `eas ${args[0]} failed`).trim();
    throw new Error(detail || `eas ${args.join(" ")} failed`);
  }
  return result.stdout;
}

// current eas-cli `build:view` only declares --json. --non-interactive is
// an unknown flag and the command exits with "build:view command failed."
export function viewCloudBuildViaEas(buildId, { cwd, env } = {}) {
  if (!isBuildId(buildId)) {
    throw new Error("eas build:view requires a UUID build id.");
  }
  const stdout = runEas(["build:view", buildId, "--json"], { cwd, env });
  const build = pickCloudBuild(stdout);
  if (!build) {
    throw new Error("eas build:view did not print a build object.");
  }
  return build;
}

export function listCloudBuildsViaEas({ cwd, env, limit = 20 } = {}) {
  const stdout = runEas(
    [
      "build:list",
      "--platform",
      "ios",
      "--build-profile",
      "production",
      "--distribution",
      "store",
      "--limit",
      String(limit),
      "--json",
    ],
    { cwd, env },
  );
  const values = extractJsonValues(stdout);
  const parsed = values.at(-1);
  const builds = flattenBuildCandidates(parsed === undefined ? values : [parsed]).filter(
    (candidate) => candidate && typeof candidate === "object" && nonEmptyString(candidate.id),
  );
  if (builds.length === 0 && values.length === 0) {
    throw new Error("eas build:list did not print JSON.");
  }
  return builds;
}

function collectErrors(error, errors) {
  errors.push(error instanceof Error ? error.message : String(error));
}

export async function viewCloudBuild({
  buildId,
  token = NodeProcess.env.EXPO_TOKEN,
  cwd,
  env = NodeProcess.env,
  fetchImpl,
} = {}) {
  const errors = [];
  if (nonEmptyString(token)) {
    try {
      return await fetchCloudBuildById({ buildId, token, fetchImpl });
    } catch (error) {
      collectErrors(error, errors);
    }
  }
  try {
    return viewCloudBuildViaEas(buildId, { cwd, env });
  } catch (error) {
    collectErrors(error, errors);
    throw new Error(`Could not view EAS cloud build ${buildId}: ${errors.join("; ")}`);
  }
}

export async function listCloudBuilds({
  token = NodeProcess.env.EXPO_TOKEN,
  appId = NodeProcess.env.T3CODE_MOBILE_EAS_PROJECT_ID,
  cwd,
  env = NodeProcess.env,
  limit = 20,
  fetchImpl,
} = {}) {
  const errors = [];
  if (nonEmptyString(token) && nonEmptyString(appId)) {
    try {
      return await fetchCloudBuildsViaGraphql({ token, appId, limit, fetchImpl });
    } catch (error) {
      collectErrors(error, errors);
    }
  }
  try {
    return listCloudBuildsViaEas({ cwd, env, limit });
  } catch (error) {
    collectErrors(error, errors);
    throw new Error(`Could not list EAS cloud builds: ${errors.join("; ")}`);
  }
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

function intArg(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
      viewFailures: intArg(args.get("view-failures"), 0),
      maxViewFailures: intArg(args.get("max-view-failures"), 0),
    })}\n`;
  }
  throw new Error(
    "eas-cloud-build.mjs expected --read-json, --write-inflight, --read-inflight, --wait-outcome, --view-id, or --list-builds.",
  );
}

export async function runCliAsync(argv = NodeProcess.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.has("view-id")) {
    const build = await viewCloudBuild({
      buildId: args.get("view-id"),
      cwd: args.get("mobile-dir"),
    });
    return `${JSON.stringify(build, null, 2)}\n`;
  }
  if (args.has("list-builds")) {
    const builds = await listCloudBuilds({
      appId: args.get("app-id") || NodeProcess.env.T3CODE_MOBILE_EAS_PROJECT_ID,
      cwd: args.get("mobile-dir"),
      limit: intArg(args.get("limit"), 20),
    });
    return `${JSON.stringify(builds)}\n`;
  }
  return runCli(argv);
}

async function main() {
  NodeProcess.stdout.write(await runCliAsync());
}

const invokedAsMain =
  Boolean(NodeProcess.argv[1]) &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(NodeProcess.argv[1])).href;
if (invokedAsMain) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    NodeProcess.stderr.write(`${detail}\n`);
    NodeProcess.exitCode = 1;
  });
}
