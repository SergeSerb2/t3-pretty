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
const MAX_BIND_ATTEMPTS = 3;

const INHERITED_ENVIRONMENT_NAMES = [
  "COMSPEC",
  "ComSpec",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "PATHEXT",
  "Path",
  "SYSTEMROOT",
  "SystemRoot",
  "TZ",
  "WINDIR",
  "windir",
] as const;

class ServerBundleAttemptError extends Error {
  readonly retryableBindCollision: boolean;

  constructor(message: string, retryableBindCollision: boolean) {
    super(message);
    this.retryableBindCollision = retryableBindCollision;
  }
}

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

export const buildSmokeEnvironment = (
  baseDir: string,
  parentEnvironment: NodeJS.ProcessEnv = NodeProcess.env,
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {
    HOME: baseDir,
    NODE_PATH: "",
    T3CODE_HOME: baseDir,
    TEMP: baseDir,
    TMP: baseDir,
    TMPDIR: baseDir,
    USERPROFILE: baseDir,
    XDG_CACHE_HOME: NodePath.join(baseDir, "cache"),
    XDG_CONFIG_HOME: NodePath.join(baseDir, "config"),
    XDG_DATA_HOME: NodePath.join(baseDir, "data"),
  };

  for (const name of INHERITED_ENVIRONMENT_NAMES) {
    const value = parentEnvironment[name];
    if (value !== undefined) environment[name] = value;
  }

  return environment;
};

const isLoopbackBindCollision = (output: string, port: number): boolean => {
  const address = `127.0.0.1:${String(port)}`;
  const namedPort = new RegExp(`\\bport\\D{0,32}${String(port)}\\b`, "u");
  return output
    .split("\n")
    .some(
      (line) =>
        /\bEADDRINUSE\b/u.test(line) &&
        (line.includes(address) || line.includes(`:${String(port)}`) || namedPort.test(line)),
    );
};

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

const waitForChildTermination = (terminated: Promise<void>, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    let finished = false;
    const finish = (terminatedInTime: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(terminatedInTime);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    void terminated.then(() => finish(true));
  });

export const stopChild = async (
  child: NodeChildProcess.ChildProcess,
  terminated: Promise<void>,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;

  try {
    child.kill();
  } catch {
    if (await waitForChildTermination(terminated, timeoutMs)) return;
    throw new Error("Server bundle child could not be stopped after its spawn failed.");
  }
  if (await waitForChildTermination(terminated, timeoutMs)) return;

  child.kill("SIGKILL");
  if (await waitForChildTermination(terminated, timeoutMs)) return;
  throw new Error("Server bundle child did not terminate after SIGKILL.");
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

const smokeServerBundleAttempt = async (input: {
  readonly entryPath: string;
  readonly cwd: string;
  readonly baseDir: string;
  readonly timeoutMs: number;
}) => {
  const port = await reserveLoopbackPort();
  const readinessUrl = `http://127.0.0.1:${String(port)}/.well-known/t3/environment`;
  const childEnvironment = buildSmokeEnvironment(input.baseDir);

  const child = NodeChildProcess.spawn(
    NodeProcess.execPath,
    [
      "--no-global-search-paths",
      input.entryPath,
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--base-dir",
      input.baseDir,
      "--no-browser",
    ],
    {
      cwd: input.cwd,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  let spawnError: Error | undefined;
  const terminated = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
    child.once("error", () => resolve());
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
        const output = redactServerOutput(`${stderr}${stdout}`);
        throw new ServerBundleAttemptError(
          `Server bundle exited before readiness (exit ${String(child.exitCode)}, signal ${String(child.signalCode)}).\n${output}`,
          isLoopbackBindCollision(output, port),
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
    await stopChild(child, terminated);
  }
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

  try {
    for (let attempt = 1; attempt <= MAX_BIND_ATTEMPTS; attempt += 1) {
      try {
        await smokeServerBundleAttempt({ ...input, entryPath, cwd, baseDir });
        return;
      } catch (error) {
        if (
          attempt === MAX_BIND_ATTEMPTS ||
          !(error instanceof ServerBundleAttemptError && error.retryableBindCollision)
        ) {
          throw error;
        }
      }
    }
  } finally {
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
