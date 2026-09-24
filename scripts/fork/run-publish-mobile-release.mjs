#!/usr/bin/env node
// Cross-platform entry for :iphone: iOS OTA + TestFlight. Windows
// Buildkite services do not put Git Bash on PATH; Mac/Linux already have bash.
// This finds bash, forces Expo cloud on win32 (no Xcode), then execs
// publish-mobile-release.sh. Do not set T3CODE_FORCE_IOS here.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const script = NodePath.join(here, "publish-mobile-release.sh");

export function isWindows(platform = NodeProcess.platform) {
  return platform === "win32";
}

export function bashCandidates(env = NodeProcess.env, platform = NodeProcess.platform) {
  if (!isWindows(platform)) {
    return ["bash"];
  }
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  return [`${programFiles}\\Git\\bin\\bash.exe`, "bash"];
}

export function envForHost(base = NodeProcess.env, platform = NodeProcess.platform) {
  if (!isWindows(platform)) {
    return base;
  }
  const env = { ...base };
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const extra = [
    `${programFiles}\\Git\\bin`,
    `${programFiles}\\nodejs`,
    // Same service exe Windows NSIS uses for cluster secret get.
    // Git Bash `command -v buildkite-agent` misses it otherwise.
    "C:\\buildkite-agent\\service",
    "C:\\buildkite-agent\\bin",
    "C:\\buildkite-agent\\vite-plus\\bin",
  ];
  const current = env.Path || env.PATH || "";
  env.Path = [...extra, current].join(";");
  env.PATH = env.Path;
  // Leave VP_HOME unset so publish-mobile-release.sh can rewrite it to
  // /c/buildkite-agent/vite-plus. A Windows path here skips that branch
  // and puts C:\... on PATH inside Git Bash.
  delete env.VP_HOME;
  env.T3CODE_IOS_ALLOW_EAS_CLOUD = env.T3CODE_IOS_ALLOW_EAS_CLOUD || "1";
  delete env.T3CODE_IOS_LOCAL_XCODE;
  return env;
}

function run(scriptPath = script) {
  const env = envForHost();
  for (const bash of bashCandidates()) {
    const result = NodeChildProcess.spawnSync(bash, [scriptPath], {
      stdio: "inherit",
      env,
    });
    if (result.error && result.error.code === "ENOENT") {
      continue;
    }
    NodeProcess.exit(result.status ?? 1);
  }
  console.error("Could not find bash to run publish-mobile-release.sh");
  NodeProcess.exit(1);
}

const invokedAsMain =
  Boolean(NodeProcess.argv[1]) &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(NodeProcess.argv[1])).href;
if (invokedAsMain) {
  run();
}
