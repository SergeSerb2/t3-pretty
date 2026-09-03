#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalFetch:off globalDate:off - This build boundary must exercise a real child process and HTTP listener.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import { parseArgs } from "node:util";

const OUTPUT_LIMIT = 64 * 1024;
const POLL_INTERVAL_MS = 100;
const REQUEST_TIMEOUT_MS = 1_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const appendOutput = (current: string, chunk: unknown): string =>
  `${current}${String(chunk)}`.slice(-OUTPUT_LIMIT);

export const redactServerOutput = (output: string): string =>
  output
    .replace(/^Token: .*$/gmu, "Token: [redacted]")
    .replace(/^Pairing URL: .*$/gmu, "Pairing URL: [redacted]");

const reserveLoopbackPort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = NodeNet.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (typeof address !== "object" || address === null || address.port <= 0) {
          reject(new Error("Could not reserve a loopback port for the server bundle smoke test."));
          return;
        }
        resolve(address.port);
      });
    });
  });

const stopChild = async (
  child: NodeChildProcess.ChildProcess,
  exited: Promise<void>,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;

  try {
    child.kill();
  } catch {
    return;
  }
  await Promise.race([exited, delay(SHUTDOWN_TIMEOUT_MS)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
};

const readEnvironmentDescriptor = async (url: string, timeoutMs: number): Promise<boolean> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return false;
  const descriptor: unknown = await response.json();
  return (
    typeof descriptor === "object" &&
    descriptor !== null &&
    "serverVersion" in descriptor &&
    typeof descriptor.serverVersion === "string"
  );
};

export async function smokeServerBundle(input: {
  readonly entryPath: string;
  readonly cwd: string;
  readonly timeoutMs: number;
}): Promise<void> {
  const entryPath = NodePath.resolve(input.entryPath);
  const cwd = NodePath.resolve(input.cwd);
  await NodeFS.access(entryPath);
  const baseDir = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-server-smoke-"));
  const port = await reserveLoopbackPort();
  const readinessUrl = `http://127.0.0.1:${String(port)}/.well-known/t3/environment`;
  const childEnvironment: NodeJS.ProcessEnv = { ...NodeProcess.env, NODE_PATH: "" };
  for (const name of [
    "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
    "T3CODE_BOOTSTRAP_FD",
    "T3CODE_DESKTOP_TELEMETRY_FD",
    "T3CODE_DEV_ALLOWED_ORIGINS",
    "T3CODE_HOME",
    "T3CODE_HOST",
    "T3CODE_MODE",
    "T3CODE_NO_BROWSER",
    "T3CODE_PORT",
    "VITE_DEV_SERVER_URL",
  ]) {
    delete childEnvironment[name];
  }

  const child = NodeChildProcess.spawn(
    NodeProcess.execPath,
    [
      "--no-global-search-paths",
      entryPath,
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--base-dir",
      baseDir,
      "--no-browser",
    ],
    {
      cwd,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  let spawnError: Error | undefined;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.stdout?.on("data", (chunk) => {
    stdout = appendOutput(stdout, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendOutput(stderr, chunk);
  });
  child.once("error", (error) => {
    spawnError = error;
  });

  try {
    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Server bundle exited before readiness (exit ${String(child.exitCode)}, signal ${String(child.signalCode)}).\n${redactServerOutput(`${stderr}${stdout}`)}`,
        );
      }

      const remainingMs = deadline - Date.now();
      const requestTimeoutMs = Math.max(1, Math.min(REQUEST_TIMEOUT_MS, remainingMs));
      const ready = await readEnvironmentDescriptor(readinessUrl, requestTimeoutMs).catch(
        () => false,
      );
      if (ready) return;
      await delay(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    }

    throw new Error(
      `Server bundle did not become ready at ${readinessUrl} within ${String(input.timeoutMs)}ms.\n${redactServerOutput(`${stderr}${stdout}`)}`,
    );
  } finally {
    await stopChild(child, exited);
    await NodeFS.rm(baseDir, { recursive: true, force: true });
  }
}

const isEntrypoint =
  NodeProcess.argv[1] !== undefined &&
  NodePath.resolve(NodeProcess.argv[1]) === NodeURL.fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const { values } = parseArgs({
    options: {
      cwd: { type: "string", default: NodeProcess.cwd() },
      entry: { type: "string", default: "dist/bin.mjs" },
      "timeout-ms": { type: "string", default: "60000" },
    },
    strict: true,
  });
  const timeoutMs = Number(values["timeout-ms"]);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer.");
  }

  await smokeServerBundle({ entryPath: values.entry, cwd: values.cwd, timeoutMs });
  NodeProcess.stdout.write(`Server bundle smoke test passed for ${values.entry}.\n`);
}
