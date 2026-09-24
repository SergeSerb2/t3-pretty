#!/usr/bin/env node
// Counts today's tip-packaging iOS Expo spend so Buildkite can skip instead
// of burning credits. Source of truth is Expo itself (eas build:list +
// production-branch update groups), which is shared across macos-release
// Mac and Linux agents. Local `eas build --local` IPAs never appear here
// and do not count. America/Vancouver is the calendar day Serge asked for.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

export const DEFAULT_TIMEZONE = "America/Vancouver";
export const DEFAULT_LIMIT = 2;
export const DEFAULT_BRANCH = "production";
export const EXPO_GRAPHQL_URL = "https://api.expo.dev/graphql";

const UPDATE_GROUPS_QUERY = `query IosExpoDailyCapUpdates(
  $appId: String!
  $branchName: String!
  $limit: Int!
  $offset: Int!
) {
  app {
    byId(appId: $appId) {
      updateBranchByName(name: $branchName) {
        updateGroups(limit: $limit, offset: $offset, filter: { platform: IOS }) {
          id
          group
          message
          createdAt
          platform
        }
      }
    }
  }
}`;

export function parseArgs(argv) {
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

export function parseLimit(value) {
  if (value === undefined || value === "") return DEFAULT_LIMIT;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid daily limit '${value}'.`);
  }
  return parsed;
}

export function vancouverDay(now, timezone = DEFAULT_TIMEZONE) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid now timestamp '${now}'.`);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Could not format ${date.toISOString()} in ${timezone}.`);
  }
  return `${year}-${month}-${day}`;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["currentPage", "builds", "updates", "data", "items"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [value];
}

function flattenGroups(value) {
  const rows = asArray(value);
  const flattened = [];
  for (const row of rows) {
    if (Array.isArray(row)) {
      flattened.push(...row);
      continue;
    }
    if (Array.isArray(row?.updates)) {
      flattened.push(...row.updates);
      continue;
    }
    flattened.push(row);
  }
  return flattened;
}

export function createdAtOf(item) {
  const raw = item?.createdAt ?? item?.created_at ?? item?.publishedAt ?? item?.completedAt;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function platformTokens(item) {
  const values = [item?.platform, item?.platforms, item?.appPlatform];
  return values.flatMap((value) => {
    if (Array.isArray(value)) return value.map((entry) => String(entry));
    if (typeof value === "string") return value.split(/[,\s]+/u).filter(Boolean);
    return [];
  });
}

export function includesIosPlatform(item, { assumeIos = false } = {}) {
  const tokens = platformTokens(item).map((token) => token.toLowerCase());
  if (tokens.some((token) => token === "ios" || token === "all")) return true;
  if (assumeIos && tokens.length === 0) return true;
  return false;
}

export function groupIdOf(item) {
  const group = item?.group ?? item?.updateGroupId ?? item?.id;
  return typeof group === "string" && group.trim() ? group.trim() : "";
}

function readJsonFile(path, label) {
  const raw = NodeFS.readFileSync(path, "utf8").trim();
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label}: ${detail}`, { cause: error });
  }
}

export function collectIosBuilds(builds, { assumeIos = true } = {}) {
  return asArray(builds).filter((item) => includesIosPlatform(item, { assumeIos }));
}

export function collectIosUpdateGroups(updates) {
  const groups = new Map();
  for (const item of flattenGroups(updates)) {
    if (!includesIosPlatform(item)) continue;
    const id = groupIdOf(item);
    if (!id) continue;
    const createdAt = createdAtOf(item);
    const existing = groups.get(id);
    if (!existing || (createdAt && (!existing.createdAt || createdAt < existing.createdAt))) {
      groups.set(id, { id, createdAt, item });
    }
  }
  return [...groups.values()];
}

export function evaluateDailyCap({
  builds = [],
  updates = [],
  now = new Date(),
  timezone = DEFAULT_TIMEZONE,
  limit = DEFAULT_LIMIT,
  store = "fixture",
} = {}) {
  const parsedLimit = parseLimit(limit);
  const day = vancouverDay(now, timezone);
  if (parsedLimit === 0) {
    return {
      day,
      used: 0,
      limit: 0,
      remaining: Number.POSITIVE_INFINITY,
      status: "disabled",
      allowed: true,
      builds: 0,
      updates: 0,
      store,
    };
  }

  const buildEvents = collectIosBuilds(builds).filter((item) => {
    const createdAt = createdAtOf(item);
    return createdAt !== null && vancouverDay(createdAt, timezone) === day;
  });
  const updateEvents = collectIosUpdateGroups(updates).filter((item) => {
    return item.createdAt !== null && vancouverDay(item.createdAt, timezone) === day;
  });
  const used = buildEvents.length + updateEvents.length;
  const remaining = Math.max(0, parsedLimit - used);
  return {
    day,
    used,
    limit: parsedLimit,
    remaining,
    status: "ok",
    allowed: remaining > 0,
    builds: buildEvents.length,
    updates: updateEvents.length,
    store,
  };
}

export function formatCapReport(result) {
  const remaining =
    result.remaining === Number.POSITIVE_INFINITY ? "unlimited" : String(result.remaining);
  return [
    `day=${result.day}`,
    `used=${result.used}`,
    `limit=${result.limit}`,
    `remaining=${remaining}`,
    `status=${result.status}`,
    `allowed=${result.allowed}`,
    `builds=${result.builds}`,
    `updates=${result.updates}`,
    `store=${result.store}`,
  ].join("\n");
}

function parseEasJson(stdout, label) {
  const raw = stdout.trim();
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.search(/[\[{]/u);
    if (start < 0) {
      throw new Error(`${label} did not print JSON.`);
    }
    return JSON.parse(raw.slice(start));
  }
}

export function runEas(args, { cwd, env = NodeProcess.env } = {}) {
  const result = NodeChildProcess.spawnSync("eas", args, {
    cwd,
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `eas ${args[0]} failed`).trim();
    throw new Error(detail);
  }
  return result.stdout;
}

async function graphql(token, query, variables) {
  const response = await fetch(EXPO_GRAPHQL_URL, {
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

export async function fetchUpdatesViaGraphql({
  token,
  appId,
  branch = DEFAULT_BRANCH,
  limit = 25,
}) {
  const data = await graphql(token, UPDATE_GROUPS_QUERY, {
    appId,
    branchName: branch,
    limit,
    offset: 0,
  });
  const groups = data?.app?.byId?.updateBranchByName?.updateGroups;
  if (!groups) {
    throw new Error(`Expo GraphQL returned no production update groups for ${appId}.`);
  }
  return groups;
}

export function fetchBuildsViaEas({ cwd, env } = {}) {
  const stdout = runEas(
    [
      "build:list",
      "--platform",
      "ios",
      "--build-profile",
      "production",
      "--limit",
      "50",
      "--json",
      "--non-interactive",
    ],
    { cwd, env },
  );
  return parseEasJson(stdout, "eas build:list");
}

export function fetchUpdatesViaEas({ cwd, env, branch = DEFAULT_BRANCH } = {}) {
  const listStdout = runEas(
    [
      "update:list",
      "--branch",
      branch,
      "--platform",
      "ios",
      "--limit",
      "25",
      "--json",
      "--non-interactive",
    ],
    { cwd, env },
  );
  const listed = flattenGroups(parseEasJson(listStdout, "eas update:list"));
  const updates = [];
  for (const row of listed.slice(0, 15)) {
    if (createdAtOf(row) && includesIosPlatform(row)) {
      updates.push(row);
      continue;
    }
    const group = groupIdOf(row);
    if (!group) continue;
    const viewed = parseEasJson(
      runEas(["update:view", group, "--json", "--non-interactive"], { cwd, env }),
      `eas update:view ${group}`,
    );
    updates.push(...flattenGroups(viewed));
  }
  return updates;
}

export async function fetchExpoIosRecords({
  token,
  appId,
  branch = DEFAULT_BRANCH,
  cwd,
  env = NodeProcess.env,
} = {}) {
  const builds = fetchBuildsViaEas({ cwd, env });
  if (token && appId) {
    try {
      return {
        builds,
        updates: await fetchUpdatesViaGraphql({ token, appId, branch }),
        store: "expo-api",
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      NodeProcess.stderr.write(
        `Expo GraphQL update query failed (${detail}); falling back to eas update:list.\n`,
      );
    }
  }
  return {
    builds,
    updates: fetchUpdatesViaEas({ cwd, env, branch }),
    store: "expo-cli",
  };
}

export function unknownCapReport({
  limit = DEFAULT_LIMIT,
  timezone = DEFAULT_TIMEZONE,
  now = new Date(),
} = {}) {
  return {
    day: vancouverDay(now, timezone),
    used: -1,
    limit: parseLimit(limit),
    remaining: -1,
    status: "unknown",
    allowed: true,
    builds: -1,
    updates: -1,
    store: "unavailable",
  };
}

export async function evaluateFromArgs(args, { env = NodeProcess.env } = {}) {
  const timezone = args.get("timezone") || DEFAULT_TIMEZONE;
  const limit = parseLimit(args.get("limit"));
  const now = args.get("now") || new Date();
  if (args.get("fetch") === "true") {
    try {
      const fetched = await fetchExpoIosRecords({
        token: env.EXPO_TOKEN,
        appId: args.get("app-id") || env.T3CODE_MOBILE_EAS_PROJECT_ID,
        branch: args.get("branch") || DEFAULT_BRANCH,
        cwd: args.get("mobile-dir"),
        env,
      });
      return evaluateDailyCap({
        builds: fetched.builds,
        updates: fetched.updates,
        now,
        timezone,
        limit,
        store: fetched.store,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      NodeProcess.stderr.write(`Could not read today's iOS Expo usage: ${detail}\n`);
      return unknownCapReport({ limit, timezone, now });
    }
  }

  const builds = args.has("builds-file")
    ? readJsonFile(args.get("builds-file"), "builds file")
    : [];
  const updates = args.has("updates-file")
    ? readJsonFile(args.get("updates-file"), "updates file")
    : [];
  return evaluateDailyCap({ builds, updates, now, timezone, limit, store: "fixture" });
}

const invokedDirectly = import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1] ?? "").href;

if (invokedDirectly) {
  const result = await evaluateFromArgs(parseArgs(NodeProcess.argv.slice(2)));
  NodeProcess.stdout.write(`${formatCapReport(result)}\n`);
}
