#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
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
  if (current.split(NodePath.delimiter).includes(localBin)) return current;
  return `${localBin}${NodePath.delimiter}${current}`;
}

export function redactCommandArgs(args) {
  const redacted = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    redacted.push(arg);
    if (arg === "--api-key" || arg === "--token") {
      redacted.push("***");
      index += 1;
    }
  }
  return redacted;
}

export function runCommand(command, args, options = {}) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: withLocalBinPath(process.env), ...options.env },
    cwd: options.cwd,
  });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(
      `${command} ${redactCommandArgs(args).join(" ")} failed (${result.status ?? "spawn"}): ${detail || result.error?.message || "no output"}`,
    );
  }
  return (result.stdout ?? "").trim();
}

export function runOrigin(args, options = {}) {
  return runCommand(originBin(), args, options);
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
  return String(value);
}

export function isMergeableState(value) {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "object") {
    return isMergeableState(value.state ?? value.status ?? value.mergeable);
  }
  return MERGEABLE_STATES.has(String(value));
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

export function resolveUpdateFeedUrl(raw) {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  } catch {
    return undefined;
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
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
  NodeFS.appendFileSync(
    outputPath,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function installOriginCli() {
  if (commandExists(originBin()) && originBin() !== "origin") return originBin();
  if (commandExists("origin")) return "origin";
  runCommand("sh", ["-c", `curl -fsSL ${ORIGIN_CLI_INSTALL_URL} | sh`]);
  return originBin();
}

function commandExists(command) {
  if (command.includes(NodePath.sep)) return NodeFS.existsSync(command);
  const result = NodeChildProcess.spawnSync("sh", ["-c", `command -v ${JSON.stringify(command)}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, PATH: withLocalBinPath() },
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
  const args = ["pr", "list", ...originRepoFlag(repo), "--json", "number,title,status"];
  if (state) args.push("-s", state);
  if (base) args.push("-B", base);
  if (head) args.push("-H", head);
  return pullRequestItems(parseJson(runOrigin(args), []));
}

export function findPullRequest({ repo, base, head, state = "open" } = {}) {
  const matches = listPullRequests({ repo, base, head, state });
  if (head) {
    const named = matches.find((item) => {
      const headName = item.headRefName ?? item.head ?? item.headBranch;
      return headName === head || String(headName).endsWith(`/${head}`);
    });
    if (named) return named;
  }
  return matches[0];
}

export function ensurePullRequest({ repo, base = "main", head, title, body, bodyFile } = {}) {
  if (!head) throw new Error("ensure-pr requires --head");
  if (!title) throw new Error("ensure-pr requires --title");
  const resolvedBodyFile = bodyFile || writeTempBody(body ?? "");
  const existing = findPullRequest({ repo, base, head, state: "open" });
  if (existing) {
    runOrigin([
      "pr",
      "edit",
      pullRequestNumber(existing),
      ...originRepoFlag(repo),
      "-t",
      title,
      "-F",
      resolvedBodyFile,
    ]);
    const number = pullRequestNumber(existing);
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
  const created = findPullRequest({ repo, base, head, state: "all" });
  const number = pullRequestNumber(created);
  if (!number)
    throw new Error(`Created an Origin pull request for ${head} but could not read its number.`);
  writeGitHubOutput({ number, url: pullRequestUrl(number) });
  return number;
}

export function pullRequestUrl(number, repo = ORIGIN_FULL_NAME) {
  return `${ORIGIN_WEB_URL.replace(ORIGIN_FULL_NAME, repo)}/pull/${number}`;
}

export function viewPullRequest(target, { repo } = {}) {
  const fields = ["number,status,mergeability,ciState", "number,status"];
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

export function waitForMergeable(target, { repo, attempts = 12, delayMs = 5000 } = {}) {
  let last = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const viewed = viewPullRequest(target, { repo });
    const state = viewed.mergeability ?? viewed.mergeableState;
    if (state == null) return viewed;
    last = typeof state === "object" ? JSON.stringify(state) : String(state);
    if (isMergeableState(state)) return viewed;
    if (attempt < attempts - 1) sleep(delayMs);
  }
  throw new Error(
    `Origin pull request ${target} remained ${last || "unknown"} and could not be merged.`,
  );
}

export function mergePullRequest({ repo, target, sha } = {}) {
  if (!target) throw new Error("merge-pr requires a pull request number or head branch");
  try {
    waitForMergeable(target, { repo });
  } catch {
    // Origin's --auto merge waits for its own requirements when view JSON
    // does not expose a GitHub-shaped mergeable_state.
  }
  const args = ["pr", "merge", String(target), ...originRepoFlag(repo), "--auto"];
  if (sha) args.push("--sha", sha);
  try {
    return runOrigin(args);
  } catch (error) {
    const message = String(error.message);
    if (sha && message.includes("unknown flag")) {
      return runOrigin(["pr", "merge", String(target), ...originRepoFlag(repo), "--auto"]);
    }
    if (message.includes("unknown flag") && message.includes("auto")) {
      return runOrigin(["pr", "merge", String(target), ...originRepoFlag(repo)]);
    }
    throw error;
  }
}

export function deleteBranch(head, { remote = "origin" } = {}) {
  if (!head) throw new Error("delete-branch requires --head");
  try {
    runCommand("git", ["push", remote, "--delete", head]);
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
  const blob = runCommand("git", ["hash-object", "-w", reportFile]);
  const indexFile = NodePath.join(NodeOS.tmpdir(), `t3-pretty-sync-blocked-${process.pid}`);
  NodeFS.rmSync(indexFile, { force: true });
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    runCommand("git", ["fetch", "origin", "main"], { env });
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
  runCommand("git", ["push", "--force", "origin", `${commit}:refs/heads/${head}`]);
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
    return runCommand("depot", args);
  }
  process.stdout.write(
    `No Depot dispatch token; Origin-connected CI should start ${workflowPath} from the ${ref} push or pull request merge.\n`,
  );
  return "";
}

export function publishOriginRelease({ tag, target, title, notesFile, assets = [] } = {}) {
  if (!tag) throw new Error("publish-release requires --tag");
  if (!target) throw new Error("publish-release requires --target");
  const feedUrl = defaultUpdateFeedUrl();
  if (!feedUrl) {
    throw new Error("T3CODE_DESKTOP_UPDATE_FEED_URL must be an http(s) generic updater feed.");
  }
  if (isGitHubFeedUrl(feedUrl)) {
    throw new Error(
      `T3CODE_DESKTOP_UPDATE_FEED_URL still points at GitHub (${feedUrl}). Point it at the Origin-hosted object store.`,
    );
  }

  const notes =
    notesFile && NodeFS.existsSync(notesFile) ? NodeFS.readFileSync(notesFile, "utf8") : "";
  const existing = runCommand("git", ["tag", "--list", tag]);
  if (!existing) {
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
  runCommand("git", ["push", "origin", `refs/tags/${tag}`]);
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
  if (!NodeFS.existsSync(filePath)) {
    throw new Error(`Release asset does not exist: ${filePath}`);
  }
  const bucket = process.env.T3CODE_RELEASE_S3_BUCKET;
  if (!bucket) {
    throw new Error(
      "T3CODE_RELEASE_S3_BUCKET is required to upload Origin desktop updater assets.",
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
  const path = NodePath.join(NodeOS.tmpdir(), `t3-pretty-origin-${process.pid}-${Date.now()}.md`);
  NodeFS.writeFileSync(path, body.endsWith("\n") ? body : `${body}\n`);
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
        target: rest.find((value) => !value.startsWith("--")) ?? readFlag(rest, "--head"),
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
