#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export const ORIGIN_OWNER = "serbinenko";
export const ORIGIN_REPO = "t3-pretty";
export const ORIGIN_FULL_NAME = `${ORIGIN_OWNER}/${ORIGIN_REPO}`;
export const ORIGIN_GIT_URL = `https://origin.cursor.com/${ORIGIN_FULL_NAME}.git`;
export const ORIGIN_WEB_URL = `https://cursor.com/codebase/${ORIGIN_FULL_NAME}`;
export const UPSTREAM_GIT_URL = "https://github.com/pingdotgg/t3code.git";
export const ORIGIN_CLI_INSTALL_URL = "https://downloads.cursor.com/origin/install.sh";
const RELEASE_NOTES_MAX_BYTES = 1024 * 1024;
const ORIGIN_BODY_MAX_BYTES = 8 * 1024 * 1024;

const MERGEABLE_STATES = new Set([
  "clean",
  "unstable",
  "mergeable",
  "ready",
  "MERGEABLE",
  "MERGEABLE_STATE_MERGEABLE",
]);

export function originRepoFlag(repo = process.env.ORIGIN_REPO || ORIGIN_FULL_NAME) {
  return ["-R", repo];
}

export function originBin() {
  const fromPath = "origin";
  const local = NodePath.join(NodeOS.homedir(), ".local", "bin", "origin");
  if (NodeFS.existsSync(local)) return local;
  return fromPath;
}

export function withLocalBinPath(env = process.env) {
  const localBin = NodePath.join(NodeOS.homedir(), ".local", "bin");
  const current = env.PATH ?? "";
  if (!current) return localBin;
  if (current.split(NodePath.delimiter).includes(localBin)) return current;
  return `${localBin}${NodePath.delimiter}${current}`;
}

/** Env for Origin CLI / git helpers. Buildkite's FORCE_COLOR+NO_COLOR pair can 255 bun. */
export function originChildEnv(env = process.env) {
  const next = { ...env, PATH: withLocalBinPath(env) };
  delete next.NO_COLOR;
  if (next.FORCE_COLOR === "1" || next.FORCE_COLOR === "true") {
    next.FORCE_COLOR = "0";
  }
  next.GIT_TERMINAL_PROMPT = "0";
  return next;
}

export function redactCommandArgs(args) {
  const redacted = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    redacted.push(redactSensitiveValues(arg, sensitiveValues));
    if (arg === "--api-key" || arg === "--token") {
      redacted.push("***");
      index += 1;
    }
  }
  return redacted;
}

export function usableGitCredentialStore(path) {
  if (!path) return false;
  try {
    return NodeFS.statSync(path).size > 0;
  } catch {
    return false;
  }
}

export function originGitConfigArgs() {
  const stores = [
    process.env.ORIGIN_GIT_CREDENTIALS,
    NodePath.join(NodeOS.homedir(), ".git-credentials"),
    "/opt/homebrew/var/buildkite-agent/.git-credentials",
  ].filter(Boolean);
  const store = stores.find((path) => usableGitCredentialStore(path));
  if (!store) return [];
  return [
    "-c",
    "credential.helper=",
    "-c",
    `credential.https://origin.cursor.com.helper=store --file=${store}`,
    "-c",
    `credential.https://origin.cursor.com/git.helper=store --file=${store}`,
  ];
}

export function runCommand(command, args, options = {}) {
  const inheritedEnv = options.inheritEnv === false ? {} : process.env;
  const commandEnv = { ...inheritedEnv, ...options.env };
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    // origin pr diff of seed JSON exceeds Node's 1 MiB default and returns status null.
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    env: { ...originChildEnv(process.env), ...options.env },
    cwd: options.cwd,
  });
  if (result.status !== 0) {
    const detail = safeCommandDiagnostic(
      redactCommandOutput(
        [result.stderr, result.stdout].filter(Boolean).join("\n").trim(),
        commandEnv,
        args,
        options.redactValues,
      ),
    );
    const fallback = safeCommandDiagnostic(
      redactCommandOutput(
        result.error?.message || "no output",
        commandEnv,
        args,
        options.redactValues,
      ),
    );
    const safeArgs = safeCommandDiagnostic(redactCommandArgs(args, options.redactValues).join(" "));
    throw new Error(
      `${command} ${safeArgs} failed (${result.status ?? "spawn"}): ${detail || fallback}`,
    );
  }
  return (result.stdout ?? "").trim();
}

export function runOrigin(args, options = {}) {
  return runCommand(originBin(), args, {
    ...options,
    env: { ...originInstallerEnvironment(), ...options.env },
    inheritEnv: false,
  });
}

export function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function pullRequestItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.pullRequests)) return payload.pullRequests;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

export function pullRequestNumber(payload) {
  const value = payload?.number ?? payload?.id ?? payload?.pullRequest?.number;
  if (value === undefined || value === null || value === "") return undefined;
  const number = String(value);
  return /^\d+$/u.test(number) ? number : undefined;
}

export function pullRequestHeadName(item) {
  return item?.headRef ?? item?.headRefName ?? item?.head ?? item?.headBranch;
}

export function pullRequestStatus(viewed) {
  return String(viewed?.status ?? viewed?.state ?? "").toLowerCase();
}

export function isPullRequestMerged(viewed) {
  if (viewed == null) return false;
  if (pullRequestStatus(viewed) === "merged") return true;
  if (viewed.mergedAt || viewed.mergeCommitSha) return true;
  return false;
}

export function mergeConflictPaths(viewed) {
  const mergeability = viewed?.mergeability;
  if (!mergeability || typeof mergeability !== "object") return [];
  if (Array.isArray(mergeability.conflictedPaths) && mergeability.conflictedPaths.length > 0) {
    return mergeability.conflictedPaths.map(String);
  }
  const inner = mergeability.mergeability;
  if (inner && Array.isArray(inner.blockers)) {
    const fromBlockers = inner.blockers.flatMap((blocker) =>
      Array.isArray(blocker?.conflictedPaths) ? blocker.conflictedPaths.map(String) : [],
    );
    if (fromBlockers.length > 0) return fromBlockers;
  }
  return [];
}

export function hasMergeConflicts(viewed) {
  const mergeability = viewed?.mergeability;
  if (!mergeability || typeof mergeability !== "object") return false;
  if (mergeability.hasMergeConflicts === true) return true;
  return mergeConflictPaths(viewed).length > 0;
}

export function isMergeableState(value) {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "object") {
    if (value.hasMergeConflicts === true) return false;
    if (Array.isArray(value.conflictedPaths) && value.conflictedPaths.length > 0) return false;
    if (value.verdict != null) return isMergeableState(value.verdict);
    if (value.mergeability && typeof value.mergeability === "object") {
      return isMergeableState(value.mergeability);
    }
    return isMergeableState(value.state ?? value.status ?? value.mergeable);
  }
  const normalized = String(value);
  if (/^(blocked|dirty|conflicting|conflicted|unmergeable)$/iu.test(normalized)) return false;
  return MERGEABLE_STATES.has(normalized);
}

export function blockedSyncBranch(upstreamTag) {
  return `automation/sync-blocked-${String(upstreamTag).replaceAll(/[^0-9A-Za-z._-]/gu, "-")}`;
}

export function isGitHubFeedUrl(raw) {
  try {
    const hostname = new URL(raw).hostname;
    return hostname === "github.com" || hostname.endsWith(".github.com");
  } catch {
    return /github\.com/i.test(raw);
  }
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function resolveUpdateFeedUrl(raw) {
  const source = raw ?? "";
  if (Buffer.byteLength(source, "utf8") > 4096) return undefined;
  const trimmed = source.trim();
  if (!trimmed || containsControlCharacter(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    // Updater channel files resolve relative to this public directory. Do not
    // embed credentials or token-like query state in release metadata.
    if (!parsed.pathname.endsWith("/")) parsed.pathname = `${parsed.pathname}/`;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function defaultUpdateFeedUrl() {
  return resolveUpdateFeedUrl(process.env.T3CODE_DESKTOP_UPDATE_FEED_URL ?? "");
}

/** S3 key prefix matching the public feed directory, or T3CODE_RELEASE_S3_PREFIX. */
export function resolveReleaseObjectPrefix() {
  const explicit = process.env.T3CODE_RELEASE_S3_PREFIX?.trim();
  if (explicit) return explicit.replace(/^\/+|\/+$/g, "");
  const feedUrl = defaultUpdateFeedUrl();
  if (!feedUrl) return "";
  try {
    return new URL(feedUrl).pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return "";
  }
}

export function resolveReleaseObjectKey(fileName) {
  const base = NodePath.basename(fileName);
  const prefix = resolveReleaseObjectPrefix();
  return prefix ? `${prefix}/${base}` : base;
}

export function writeGitHubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const entries = Object.entries(values).map(([key, rawValue]) => {
    const value = String(rawValue);
    if (
      !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(key) ||
      Buffer.byteLength(value, "utf8") > 8192 ||
      containsControlCharacter(value)
    ) {
      throw new Error("GitHub output key or value is outside its safety boundary.");
    }
    return `${key}=${value}`;
  });
  NodeFS.appendFileSync(outputPath, entries.join("\n") + "\n");
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function installOriginCli() {
  if (commandExists(originBin()) && originBin() !== "origin") return originBin();
  if (commandExists("origin")) return "origin";
  runCommand("sh", ["-c", `curl -fsSL ${ORIGIN_CLI_INSTALL_URL} | sh`], {
    inheritEnv: false,
    env: originInstallerEnvironment(),
  });
  return originBin();
}

export function originInstallerEnvironment(env = process.env) {
  const safe = {};
  for (const key of [
    "CI",
    "GITHUB_ACTIONS",
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LANG",
    "LC_ALL",
    "LOGNAME",
    "NO_PROXY",
    "PATH",
    "SHELL",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
    "XDG_BIN_HOME",
    "XDG_DATA_HOME",
    "https_proxy",
    "http_proxy",
    "no_proxy",
  ]) {
    if (env[key] !== undefined) safe[key] = env[key];
  }
  return safe;
}

function commandExists(command) {
  if (command.includes(NodePath.sep)) return NodeFS.existsSync(command);
  const env = originInstallerEnvironment();
  const result = NodeChildProcess.spawnSync("sh", ["-c", `command -v ${JSON.stringify(command)}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...env, PATH: withLocalBinPath(env) },
  });
  return result.status === 0;
}

export function setupOriginAuth() {
  installOriginCli();
  const apiKey = process.env.CURSOR_API_KEY || process.env.ORIGIN_TOKEN;
  if (apiKey) {
    try {
      runOrigin(["auth", "login", "--api-key", apiKey, "--local"]);
    } catch {
      runOrigin(["auth", "login", "--api-key", apiKey]);
    }
  } else {
    runOrigin(["auth", "status"]);
  }
  try {
    runOrigin(["auth", "setup-git", "--local"]);
  } catch {
    // User logins already install the helper; a missing flag must not fail CI.
  }
}

export function listPullRequests({ repo, base, head, state = "open" } = {}) {
  const fields = ["number,title,status,headRef,headSha", "number,title,status"];
  for (const json of fields) {
    const args = ["pr", "list", ...originRepoFlag(repo), "--json", json];
    if (state) args.push("-s", state);
    if (base) args.push("-B", base);
    if (head) args.push("-H", head);
    try {
      return pullRequestItems(parseJson(runOrigin(args), []));
    } catch (error) {
      if (json === fields.at(-1)) throw error;
    }
  }
  return [];
}

export function findPullRequest({ repo, base, head, state = "open" } = {}) {
  const matches = listPullRequests({ repo, base, head, state });
  if (head) {
    const named = matches.find((item) => {
      const headName = pullRequestHeadName(item);
      return headName === head || String(headName).endsWith(`/${head}`);
    });
    if (named) return named;
  }
  // Older Origin CLIs omit headRef from --json; -H already filtered the list.
  return matches[0];
}

export function ensurePullRequest({ repo, base = "main", head, title, body, bodyFile } = {}) {
  if (!head) throw new Error("ensure-pr requires --head");
  if (!title) throw new Error("ensure-pr requires --title");
  const resolvedBodyFile = writeTempBody(bodyFile ? readOriginBodyFile(bodyFile) : (body ?? ""));
  try {
    const existing = findPullRequest({ repo, base, head, state: "open" });
    if (existing) {
      const number = pullRequestNumber(existing);
      if (!number) {
        throw new Error(`Origin returned an invalid pull request number for ${head}.`);
      }
      runOrigin([
        "pr",
        "edit",
        number,
        ...originRepoFlag(repo),
        "-t",
        title,
        "-F",
        resolvedBodyFile,
      ]);
      writeGitHubOutput({ number, url: pullRequestUrl(number) });
      return number;
    }

    runOrigin([
      "pr",
      "create",
      ...originRepoFlag(repo),
      "-t",
      title,
      "-F",
      resolvedBodyFile,
      "-H",
      head,
      "-B",
      base,
      "--status",
      "open",
    ]);
    // A reused branch name can have older closed pull requests. After creating
    // an explicitly open PR, only an exact open-head match can identify it.
    const created = findPullRequest({ repo, base, head, state: "open" });
    const number = pullRequestNumber(created);
    if (!number)
      throw new Error(`Created an Origin pull request for ${head} but could not read its number.`);
    writeGitHubOutput({ number, url: pullRequestUrl(number) });
    return number;
  } finally {
    NodeFS.rmSync(resolvedBodyFile, { force: true });
  }
}

export function pullRequestUrl(number, repo = ORIGIN_FULL_NAME) {
  return `${ORIGIN_WEB_URL.replace(ORIGIN_FULL_NAME, repo)}/pull/${number}`;
}

export function viewPullRequest(target, { repo } = {}) {
  const fields = [
    "number,status,mergeability,ciState,headSha,headRef,mergedAt,mergeCommitSha",
    "number,status,mergeability,headSha",
    "number,status",
  ];
  for (const json of fields) {
    try {
      return parseJson(
        runOrigin(["pr", "view", String(target), ...originRepoFlag(repo), "--json", json]),
        {},
      );
    } catch (error) {
      if (json === fields.at(-1)) throw error;
    }
  }
  return {};
}

export function describeMergeConflicts(target, viewed) {
  const paths = mergeConflictPaths(viewed);
  const suffix = paths.length > 0 ? `: ${paths.join(", ")}` : ".";
  return `Origin pull request ${target} has merge conflicts${suffix}`;
}

export function waitForMergeable(target, { repo, attempts = 12, delayMs = 5000 } = {}) {
  let last = "";
  let lastViewed;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const viewed = viewPullRequest(target, { repo });
    lastViewed = viewed;
    if (isPullRequestMerged(viewed)) return viewed;
    if (hasMergeConflicts(viewed)) {
      throw new Error(describeMergeConflicts(target, viewed));
    }
    // Origin reports null, {}, or { mergeable: null } while it computes
    // mergeability. None of those are a verdict; only a real state, a
    // merged status, or conflicts above may end the wait early.
    const state = viewed.mergeability ?? viewed.mergeableState;
    if (state != null) {
      last = typeof state === "object" ? JSON.stringify(state) : String(state);
      if (isMergeableState(state)) return viewed;
    }
    if (attempt < attempts - 1) sleep(delayMs);
  }
  // A CLI whose --json never exposes mergeability leaves `last` empty; let
  // the caller try the merge instead of failing on missing information.
  if (!last) return lastViewed;
  throw new Error(`Origin pull request ${target} remained ${last} and could not be merged.`);
}

export function originUnknownOption(message, name) {
  const text = String(message).toLowerCase();
  const option = String(name).toLowerCase();
  return (
    (text.includes("unknown flag") || text.includes("unknown argument")) && text.includes(option)
  );
}

export function resolvePullRequestTarget({ repo, target } = {}) {
  if (!target) throw new Error("merge-pr requires a pull request number or head branch");
  const raw = String(target);
  if (/^\d+$/u.test(raw)) return raw;
  const found =
    findPullRequest({ repo, head: raw, state: "open" }) ??
    findPullRequest({ repo, head: raw, state: "all" });
  return pullRequestNumber(found) ?? raw;
}

function runOriginMerge(target, { repo, extraArgs = [] } = {}) {
  return runOrigin(["pr", "merge", String(target), ...originRepoFlag(repo), ...extraArgs]);
}

export function mergePullRequest({ repo, target, sha } = {}) {
  if (!target) throw new Error("merge-pr requires a pull request number or head branch");
  const resolved = resolvePullRequestTarget({ repo, target });
  const viewed = viewPullRequest(resolved, { repo });
  if (isPullRequestMerged(viewed)) return "";
  if (hasMergeConflicts(viewed)) {
    throw new Error(describeMergeConflicts(resolved, viewed));
  }
  if (sha) {
    const headSha = String(viewed.headSha ?? "").trim();
    if (headSha && !headSha.startsWith(sha) && !sha.startsWith(headSha)) {
      throw new Error(`Origin pull request ${resolved} head is ${headSha}, expected ${sha}.`);
    }
  }
  try {
    waitForMergeable(resolved, { repo });
  } catch (error) {
    if (String(error.message).includes("has merge conflicts")) throw error;
    // Origin mergeability JSON is still computing; try the merge anyway.
  }
  // Origin CLI has no --sha on `pr merge`. Pin the head ourselves above.
  // --auto only enables merge-when-ready and can return 0 before the change
  // lands. Prefer an immediate merge commit, then wait until Origin reports
  // merged so the caller never deletes the head branch of an open change.
  let lastError;
  for (const extraArgs of [["--merge"], [], ["--auto"]]) {
    try {
      runOriginMerge(resolved, { repo, extraArgs });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      const now = viewPullRequest(resolved, { repo });
      if (isPullRequestMerged(now)) return "";
      const message = String(error.message);
      if (/conflict/iu.test(message) || hasMergeConflicts(now)) {
        throw new Error(describeMergeConflicts(resolved, now));
      }
      const flag = extraArgs[0]?.replace(/^--/u, "") ?? "";
      if (flag && originUnknownOption(message, flag)) continue;
    }
  }
  if (lastError) throw lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const now = viewPullRequest(resolved, { repo });
    if (isPullRequestMerged(now)) return "";
    if (hasMergeConflicts(now)) {
      throw new Error(describeMergeConflicts(resolved, now));
    }
    if (attempt < 23) sleep(5000);
  }
  throw new Error(`Origin pull request ${resolved} did not merge.`);
}

export function deleteBranch(head, { remote = "origin" } = {}) {
  if (!head) throw new Error("delete-branch requires --head");
  try {
    runCommand("git", [...originGitConfigArgs(), "push", remote, "--delete", head]);
  } catch {
    // The merge step may already have deleted the branch.
  }
}

export function reportBlockedSync({
  repo,
  upstreamTag,
  body,
  title = `Upstream sync blocked: ${upstreamTag}`,
} = {}) {
  if (!upstreamTag) throw new Error("report-blocked requires --upstream-tag");
  const head = blockedSyncBranch(upstreamTag);
  const report = `${body?.trim() || title}\n`;
  const reportFile = writeTempBody(report);
  const indexFile = NodePath.join(NodeOS.tmpdir(), `t3-pretty-sync-blocked-${process.pid}`);
  NodeFS.rmSync(indexFile, { force: true });
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    runCommand("git", [...originGitConfigArgs(), "fetch", "origin", "main"], { env });
  } catch {
    // A failed merge may still have origin/main from the checkout step.
  }
  const parent = runCommand("git", ["rev-parse", "origin/main"]);
  runCommand("git", ["read-tree", parent], { env });
  runCommand(
    "git",
    ["update-index", "--add", "--cacheinfo", "100644", blob, ".t3-fork/upstream-sync-blocked.md"],
    { env },
  );
  const tree = runCommand("git", ["write-tree"], { env });
  const commit = runCommand(
    "git",
    [
      "-c",
      "user.name=t3-pretty-sync[bot]",
      "-c",
      "user.email=t3-pretty-bot@users.noreply.cursor.com",
      "commit-tree",
      tree,
      "-p",
      parent,
      "-m",
      title,
    ],
    { env },
  );
  runCommand("git", [
    ...originGitConfigArgs(),
    "push",
    "--force",
    "origin",
    `${commit}:refs/heads/${head}`,
  ]);
  return ensurePullRequest({
    repo,
    base: "main",
    head,
    title,
    body: report,
  });
}

export function dispatchWorkflow(workflow, { ref = "main", inputs = {} } = {}) {
  const workflowFile = workflow.endsWith(".yml") ? workflow : `${workflow}.yml`;
  const workflowPath = workflowFile.includes("/")
    ? workflowFile
    : `.github/workflows/${workflowFile}`;
  if (commandExists("depot") && (process.env.DEPOT_TOKEN || process.env.DEPOT_API_TOKEN)) {
    const args = ["ci", "run", "--workflow", workflowPath, "--branch", ref];
    for (const [key, value] of Object.entries(inputs)) {
      args.push("--input", `${key}=${value}`);
    }
    const env = originInstallerEnvironment();
    for (const key of ["DEPOT_API_TOKEN", "DEPOT_TOKEN"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return runCommand("depot", args, { env, inheritEnv: false });
  }
  process.stdout.write(
    `No Depot dispatch token; Origin-connected CI should start ${workflowPath} from the ${ref} push or pull request merge.\n`,
  );
  return "";
}

export function resolveReleaseAssetObjectKey(raw) {
  if (
    typeof raw !== "string" ||
    !raw ||
    raw === "." ||
    raw === ".." ||
    raw !== NodePath.basename(raw) ||
    Buffer.byteLength(raw, "utf8") > 255 ||
    raw.includes("\\") ||
    containsControlCharacter(raw)
  ) {
    return undefined;
  }
  return raw;
}

export function releaseAssetObjectKeys(assets) {
  if (assets.length === 0) {
    throw new Error("publish-release requires at least one updater asset");
  }
  const objectKeys = [];
  const seen = new Set();
  for (const asset of assets) {
    const objectKey =
      typeof asset === "string"
        ? resolveReleaseAssetObjectKey(NodePath.basename(asset))
        : undefined;
    if (!objectKey) {
      throw new Error("Release asset has an invalid object name.");
    }
    if (seen.has(objectKey)) {
      throw new Error(`Release assets contain the duplicate object name '${objectKey}'.`);
    }
    seen.add(objectKey);
    objectKeys.push(objectKey);
  }
  return objectKeys;
}

export function releaseAssetUploadPlan(assets) {
  const objectKeys = releaseAssetObjectKeys(assets);
  return assets
    .map((asset, index) => ({ asset, objectKey: objectKeys[index] }))
    .sort(
      (left, right) =>
        Number(left.objectKey.endsWith(".yml")) - Number(right.objectKey.endsWith(".yml")),
    );
}

export function readReleaseNotesFile(filePath, maxBytes = RELEASE_NOTES_MAX_BYTES) {
  if (!filePath) return "";
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > RELEASE_NOTES_MAX_BYTES) {
    throw new Error(`Invalid release notes safety limit: ${maxBytes}`);
  }
  const noFollow = NodeFS.constants.O_NOFOLLOW ?? 0;
  let file;
  try {
    file = NodeFS.openSync(filePath, NodeFS.constants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Release notes file does not exist: ${filePath}`, { cause: error });
    }
    throw error;
  }
  try {
    const metadata = NodeFS.fstatSync(file);
    if (!metadata.isFile()) {
      throw new Error(`Release notes path is not a regular file: ${filePath}`);
    }
    const size = metadata.size;
    if (size > maxBytes) {
      throw new Error(`Release notes exceed the ${maxBytes}-byte safety limit: ${filePath}`);
    }
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const read = NodeFS.readSync(file, bytes, length, bytes.byteLength - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > maxBytes) {
      throw new Error(`Release notes exceed the ${maxBytes}-byte safety limit: ${filePath}`);
    }
    return bytes.subarray(0, length).toString("utf8");
  } finally {
    NodeFS.closeSync(file);
  }
}

function readUtf8Prefix(filePath, maxBytes) {
  const noFollow = NodeFS.constants.O_NOFOLLOW ?? 0;
  let file;
  try {
    file = NodeFS.openSync(filePath, NodeFS.constants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }

  try {
    const metadata = NodeFS.fstatSync(file);
    if (!metadata.isFile()) {
      throw new Error(`Release report is not a regular file: ${filePath}`);
    }
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const read = NodeFS.readSync(file, bytes, length, bytes.byteLength - length, null);
      if (read === 0) break;
      length += read;
    }

    const truncated = metadata.size > maxBytes || length > maxBytes;
    let end = Math.min(length, maxBytes);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return {
          text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end)),
          truncated,
        };
      } catch {
        end -= 1;
      }
    }
    throw new Error(`Release report is not valid UTF-8: ${filePath}`);
  } finally {
    NodeFS.closeSync(file);
  }
}

export function prepareReleaseNotesFile({ outputPath, target, upstreamTag, reportPath } = {}) {
  if (!outputPath) throw new Error("prepare-release-notes requires --output-file");
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(target ?? "")) {
    throw new Error("prepare-release-notes --target must be a full commit object ID");
  }
  if (
    !upstreamTag ||
    Buffer.byteLength(upstreamTag, "utf8") > 512 ||
    containsControlCharacter(upstreamTag)
  ) {
    throw new Error("prepare-release-notes requires a bounded upstream tag");
  }

  const header = `T3 Pretty build from \`${target}\`.\nIncludes parent T3 Code through \`${upstreamTag}\` plus all changes merged to T3 Pretty \`main\`.\n`;
  const missingReport = "\nNo parent integration report is present for this revision.\n";
  const truncationMarker =
    "\n\n_The integration report was truncated here to fit the release-note limit; the complete report remains in the repository._\n";
  const separator = "\n";
  const reportBudget =
    RELEASE_NOTES_MAX_BYTES -
    Buffer.byteLength(header, "utf8") -
    Buffer.byteLength(separator, "utf8") -
    Buffer.byteLength(truncationMarker, "utf8");
  if (reportBudget <= 0) {
    throw new Error("Release note header exceeds the release-note safety limit");
  }

  const report = reportPath ? readUtf8Prefix(reportPath, reportBudget) : undefined;
  const notes = report
    ? `${header}${separator}${report.text}${report.truncated ? truncationMarker : ""}`
    : `${header}${missingReport}`;
  if (Buffer.byteLength(notes, "utf8") > RELEASE_NOTES_MAX_BYTES) {
    throw new Error("Prepared release notes exceeded the release-note safety limit");
  }
  NodeFS.writeFileSync(outputPath, notes, { flag: "wx", mode: 0o600 });
  return notes;
}

export function publishOriginRelease({ tag, target, title, notesFile, assets = [] } = {}) {
  if (!tag) throw new Error("publish-release requires --tag");
  if (tag.startsWith("-") || containsControlCharacter(tag)) {
    throw new Error("publish-release --tag must be a valid Git tag name");
  }
  if (!target) throw new Error("publish-release requires --target");
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(target)) {
    throw new Error("publish-release --target must be a full commit object ID");
  }
  const feedUrl = defaultUpdateFeedUrl();
  if (!feedUrl) {
    throw new Error("T3CODE_DESKTOP_UPDATE_FEED_URL must be an HTTPS generic updater feed.");
  }
  if (isGitHubFeedUrl(feedUrl)) {
    throw new Error(
      `T3CODE_DESKTOP_UPDATE_FEED_URL still points at GitHub (${feedUrl}). Point it at the Origin-hosted object store.`,
    );
  }

  const uploadPlan = releaseAssetUploadPlan(assets);
  for (const { asset } of uploadPlan) {
    if (!NodeFS.existsSync(asset) || !NodeFS.lstatSync(asset).isFile()) {
      throw new Error(`Release asset is not a file: ${asset}`);
    }
  }
  const normalizedTarget = target.toLowerCase();
  runReleaseGit(["check-ref-format", `refs/tags/${tag}`]);
  const targetCommit = runReleaseGit(["rev-parse", "--verify", `${target}^{commit}`]);
  if (targetCommit.toLowerCase() !== normalizedTarget) {
    throw new Error(`Release target ${target} did not resolve to that exact commit object ID.`);
  }

  const notes = readReleaseNotesFile(notesFile);
  const existing = runReleaseGit(["tag", "--list", "--", tag]);
  if (existing) {
    const existingCommit = runReleaseGit(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]);
    if (existingCommit.toLowerCase() !== normalizedTarget) {
      throw new Error(
        `Local release tag ${tag} points to ${existingCommit}, not requested target ${targetCommit}.`,
      );
    }
  } else {
    const notePath = writeTempBody(notes || title || tag);
    // Annotated tags need a committer; CI checkouts have no user.name/email.
    runCommand("git", [
      "-c",
      "user.name=t3-pretty-release[bot]",
      "-c",
      "user.email=t3-pretty-bot@users.noreply.cursor.com",
      "tag",
      "-a",
      tag,
      target,
      "-F",
      notePath,
    ]);
  }

  // Push only after uploads: fork-release.yml skips commits that already have
  // this tag, so a pre-upload push would block retries of missing assets.
  for (const asset of assets) {
    uploadReleaseAsset(asset, resolveReleaseObjectKey(asset));
  }
  runCommand("git", [...originGitConfigArgs(), "push", "origin", `refs/tags/${tag}`]);
  writeGitHubOutput({
    tag,
    url: `${ORIGIN_WEB_URL}/releases/${encodeURIComponent(tag)}`,
    feed: feedUrl,
  });
  return feedUrl;
}

export function uploadReleaseAssets(assets = []) {
  if (!assets.length) throw new Error("upload-assets requires --asset");
  for (const asset of assets) {
    uploadReleaseAsset(asset, resolveReleaseObjectKey(asset));
  }
}

export function uploadReleaseAsset(filePath, objectKey) {
  if (!NodeFS.existsSync(filePath) || !NodeFS.lstatSync(filePath).isFile()) {
    throw new Error(`Release asset is not a regular file: ${filePath}`);
  }
  const resolvedObjectKey = resolveReleaseAssetObjectKey(objectKey);
  if (!resolvedObjectKey) {
    throw new Error("Release asset has an invalid object name.");
  }
  const rawBucket = process.env.T3CODE_RELEASE_S3_BUCKET;
  const bucket = resolveReleaseBucket(rawBucket);
  if (!bucket) {
    throw new Error(
      "T3CODE_RELEASE_S3_BUCKET must be a bounded bucket name without URI separators.",
    );
  }
  const destination = `s3://${bucket}/${resolvedObjectKey}`;
  // Channel manifests are uploaded after their referenced binaries, and AWS
  // progress output is suppressed so large installers cannot exhaust the
  // synchronous command runner's output buffer.
  const args = ["s3", "cp", NodePath.resolve(filePath), destination, "--only-show-errors"];
  const rawEndpoint = process.env.T3CODE_RELEASE_S3_ENDPOINT;
  const endpoint = rawEndpoint ? resolveReleaseEndpointUrl(rawEndpoint) : undefined;
  if (rawEndpoint && !endpoint) {
    throw new Error(
      "T3CODE_RELEASE_S3_ENDPOINT must be a bounded HTTPS URL without credentials, query, or fragment.",
    );
  }
  if (endpoint) {
    args.push("--endpoint-url", endpoint);
  }
  const env = originInstallerEnvironment();
  for (const key of [
    "AWS_ACCESS_KEY_ID",
    "AWS_CA_BUNDLE",
    "AWS_CONFIG_FILE",
    "AWS_DEFAULT_PROFILE",
    "AWS_DEFAULT_REGION",
    "AWS_EC2_METADATA_DISABLED",
    "AWS_PROFILE",
    "AWS_REGION",
    "AWS_ROLE_ARN",
    "AWS_ROLE_SESSION_NAME",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const rawAccessKeyId = process.env.T3CODE_RELEASE_S3_ACCESS_KEY_ID;
  const accessKeyId = rawAccessKeyId ? resolveReleaseCredential(rawAccessKeyId, 4096) : undefined;
  if (rawAccessKeyId && !accessKeyId) {
    throw new Error("T3CODE_RELEASE_S3_ACCESS_KEY_ID exceeds its safety limit or has controls.");
  }
  const rawSecretAccessKey = process.env.T3CODE_RELEASE_S3_SECRET_ACCESS_KEY;
  const secretAccessKey = rawSecretAccessKey
    ? resolveReleaseCredential(rawSecretAccessKey, 8192)
    : undefined;
  if (rawSecretAccessKey && !secretAccessKey) {
    throw new Error(
      "T3CODE_RELEASE_S3_SECRET_ACCESS_KEY exceeds its safety limit or has controls.",
    );
  }
  const destination = `s3://${bucket}/${objectKey}`;
  if (
    process.env.T3CODE_RELEASE_S3_ACCESS_KEY_ID &&
    process.env.T3CODE_RELEASE_S3_SECRET_ACCESS_KEY
  ) {
    const args = ["s3", "cp", filePath, destination];
    const endpoint = process.env.T3CODE_RELEASE_S3_ENDPOINT;
    if (endpoint) args.push("--endpoint-url", endpoint);
    const env = { ...process.env };
    env.AWS_ACCESS_KEY_ID = process.env.T3CODE_RELEASE_S3_ACCESS_KEY_ID;
    env.AWS_SECRET_ACCESS_KEY = process.env.T3CODE_RELEASE_S3_SECRET_ACCESS_KEY;
    if (process.env.T3CODE_RELEASE_S3_REGION) {
      env.AWS_DEFAULT_REGION = process.env.T3CODE_RELEASE_S3_REGION;
      args.push("--region", process.env.T3CODE_RELEASE_S3_REGION);
    }
    runCommand("aws", args, { env });
    return;
  }
  if (commandExists("npx") || commandExists("wrangler")) {
    const wrangler = commandExists("wrangler") ? "wrangler" : "npx";
    const args = commandExists("wrangler")
      ? ["r2", "object", "put", `${bucket}/${objectKey}`, "--file", filePath, "--remote"]
      : [
          "--yes",
          "wrangler",
          "r2",
          "object",
          "put",
          `${bucket}/${objectKey}`,
          "--file",
          filePath,
          "--remote",
        ];
    runCommand(wrangler, args);
    return;
  }
  throw new Error(
    "Set T3CODE_RELEASE_S3_ACCESS_KEY_ID/SECRET or install wrangler to upload Origin updater assets.",
  );
}

function writeTempBody(body) {
  const normalizedBody = String(body);
  const serializedBody = normalizedBody.endsWith("\n") ? normalizedBody : `${normalizedBody}\n`;
  if (Buffer.byteLength(serializedBody, "utf8") > ORIGIN_BODY_MAX_BYTES) {
    throw new Error("Origin body exceeds its safety limit.");
  }
  for (const character of normalizedBody) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      ((codePoint <= 0x1f && character !== "\n" && character !== "\r" && character !== "\t") ||
        codePoint === 0x7f)
    ) {
      throw new Error("Origin body contains an unsupported control character.");
    }
  }
  const path = NodePath.join(
    NodeOS.tmpdir(),
    `t3-pretty-origin-${process.pid}-${NodeCrypto.randomUUID()}.md`,
  );
  NodeFS.writeFileSync(path, serializedBody, {
    flag: "wx",
    mode: 0o600,
  });
  return path;
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readRepeated(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

export function readPositional(args, valueFlags = []) {
  const flags = new Set(valueFlags);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (flags.has(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith("--")) return value;
  }
  return undefined;
}

function parseInputs(rawInputs) {
  const inputs = {};
  for (const raw of rawInputs) {
    const separator = raw.indexOf("=");
    if (separator === -1) continue;
    inputs[raw.slice(0, separator)] = raw.slice(separator + 1);
  }
  return inputs;
}

export function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  switch (command) {
    case "setup-ci":
      setupOriginAuth();
      return;
    case "ensure-pr":
      ensurePullRequest({
        repo: readFlag(rest, "--repo"),
        base: readFlag(rest, "--base") ?? "main",
        head: readFlag(rest, "--head"),
        title: readFlag(rest, "--title"),
        body: readFlag(rest, "--body"),
        bodyFile: readFlag(rest, "--body-file"),
      });
      return;
    case "merge-pr":
      mergePullRequest({
        repo: readFlag(rest, "--repo"),
        target: readFlag(rest, "--head") ?? readPositional(rest, ["--repo", "--head", "--sha"]),
        sha: readFlag(rest, "--sha"),
      });
      return;
    case "delete-branch":
      deleteBranch(readFlag(rest, "--head"));
      return;
    case "report-blocked":
      reportBlockedSync({
        repo: readFlag(rest, "--repo"),
        upstreamTag: readFlag(rest, "--upstream-tag"),
        title: readFlag(rest, "--title"),
        body: readFlag(rest, "--body"),
      });
      return;
    case "dispatch":
      dispatchWorkflow(readFlag(rest, "--workflow") ?? rest[0], {
        ref: readFlag(rest, "--ref") ?? "main",
        inputs: parseInputs(readRepeated(rest, "--input")),
      });
      return;
    case "publish-release":
      publishOriginRelease({
        tag: readFlag(rest, "--tag"),
        target: readFlag(rest, "--target"),
        title: readFlag(rest, "--title"),
        notesFile: readFlag(rest, "--notes-file"),
        assets: readRepeated(rest, "--asset"),
      });
      return;
    case "upload-assets":
      uploadReleaseAssets(readRepeated(rest, "--asset"));
      return;
    default:
      throw new Error(
        `Unknown origin-forge command: ${command ?? "(missing)"}. Use setup-ci, ensure-pr, merge-pr, delete-branch, report-blocked, dispatch, publish-release, or upload-assets.`,
      );
  }
}

const invokedPath = process.argv[1] ? NodePath.resolve(process.argv[1]) : "";
if (invokedPath === NodeURL.fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
