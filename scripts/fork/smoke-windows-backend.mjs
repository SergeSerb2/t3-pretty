#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeURL from "node:url";

import { DESKTOP_LOCAL_BEARER_TOKEN_TIMEOUT_MS } from "@t3tools/contracts/desktopBearerTimeout";

export const DEFAULT_TIMEOUT_MS = DESKTOP_LOCAL_BEARER_TOKEN_TIMEOUT_MS;
export const BIND_RETRY_LIMIT = 5;
const ADDRESS_IN_USE = /EADDRINUSE|address already in use/iu;
const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const BOOTSTRAP_TOKEN_TYPE = "urn:t3:params:oauth:token-type:environment-bootstrap";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

function usage() {
  throw new Error(
    "Usage: node smoke-windows-backend.mjs <packagedAppDir> [appExecutableName] | --executable <path> --entry <path> [--timeout-ms <ms>] [--electron-as-node]",
  );
}

function parseArgs(argv) {
  const options = {
    packagedAppDir: null,
    appExecutableName: null,
    executablePath: null,
    entryPath: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    electronAsNode: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--executable") {
      options.executablePath = argv[index + 1];
      index += 1;
    } else if (arg === "--entry") {
      options.entryPath = argv[index + 1];
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(argv[index + 1] ?? "", 10);
      index += 1;
    } else if (arg === "--electron-as-node") {
      options.electronAsNode = true;
    } else if (arg.startsWith("-")) {
      usage();
    } else if (options.packagedAppDir === null) {
      options.packagedAppDir = arg;
    } else if (options.appExecutableName === null) {
      options.appExecutableName = arg;
    } else {
      usage();
    }
  }

  if (
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    (options.packagedAppDir === null &&
      (options.executablePath === null || options.entryPath === null)) ||
    (options.packagedAppDir !== null &&
      (options.executablePath !== null || options.entryPath !== null))
  ) {
    usage();
  }

  return options;
}

function resolvePackagedLaunch(options) {
  const packagedAppDir = NodePath.resolve(options.packagedAppDir);
  const executableName =
    options.appExecutableName ??
    NodeFS.readdirSync(packagedAppDir).find((name) => name.toLowerCase().endsWith(".exe"));
  if (executableName === undefined) {
    throw new Error(`Packaged Windows app at ${packagedAppDir} has no .exe.`);
  }
  return {
    executablePath: NodePath.join(packagedAppDir, executableName),
    entryPath: NodePath.join(
      packagedAppDir,
      "resources",
      "server.asar",
      "apps",
      "server",
      "dist",
      "bin.mjs",
    ),
    cwd: packagedAppDir,
    electronAsNode: true,
  };
}

export class AddressInUseError extends Error {
  constructor(port) {
    super(`Packaged backend could not bind 127.0.0.1:${port} (EADDRINUSE).`);
    this.name = "AddressInUseError";
    this.port = port;
  }
}

export function isAddressInUseOutput(output) {
  return ADDRESS_IN_USE.test(output);
}

async function reservePort() {
  const reservation = NodeNet.createServer();
  reservation.listen({ port: 0, host: "127.0.0.1", exclusive: true });
  await NodeEvents.once(reservation, "listening");
  const address = reservation.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  if (!Number.isInteger(port) || port <= 0) {
    reservation.close();
    throw new Error("Could not reserve a loopback port for the Windows backend smoke.");
  }
  return {
    port,
    release() {
      return new Promise((resolve, reject) =>
        reservation.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function inheritSparseEnv() {
  const env = {};
  for (const key of [
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "LANG",
    "SHELL",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

async function exchangeLocalBearer(port, bootstrapToken, signal) {
  const body = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: bootstrapToken,
    subject_token_type: BOOTSTRAP_TOKEN_TYPE,
    requested_token_type: ACCESS_TOKEN_TYPE,
    client_label: "T3 Pretty Desktop",
    client_device_type: "desktop",
  });
  const response = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal,
  });
  if (!response.ok) {
    throw new Error(`Packaged backend token exchange failed with HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("Packaged backend token exchange returned no access_token.");
  }
  return payload.access_token;
}

async function waitForEnvironment(port, signal) {
  const response = await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`, { signal });
  if (!response.ok || typeof (await response.json()).environmentId !== "string") {
    throw new Error("Packaged backend returned an invalid environment descriptor.");
  }
}

export function writeBootstrapEnvelope(stdin, envelope) {
  if (stdin == null) {
    return Promise.reject(new Error("Packaged backend stdin is not writable."));
  }
  const payload = `${JSON.stringify(envelope)}\n`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      stdin.off?.("error", fail);
      stdin.off?.("drain", markDrained);
      const cause = error instanceof Error ? error : new Error(String(error));
      reject(
        new Error(
          `Failed to write bootstrap envelope to packaged backend stdin: ${cause.message}`,
          { cause },
        ),
      );
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      stdin.off?.("error", fail);
      stdin.off?.("drain", markDrained);
      resolve();
    };
    let ending = false;
    const endPipe = () => {
      if (ending || settled) return;
      ending = true;
      stdin.end((endError) => {
        if (endError) fail(endError);
        else succeed();
      });
    };
    let written = false;
    let drained = false;
    const markDrained = () => {
      drained = true;
      if (written) endPipe();
    };
    const markWritten = () => {
      written = true;
      if (drained) endPipe();
    };
    stdin.once("error", fail);
    let accepted;
    try {
      accepted = stdin.write(payload, (error) => {
        if (error) fail(error);
        else markWritten();
      });
    } catch (error) {
      fail(error);
      return;
    }
    // write() false is backpressure, not a dropped envelope. Wait for drain
    // before ending so a full pipe under load does not flake the smoke.
    if (accepted === true) {
      drained = true;
      if (written) endPipe();
    } else {
      stdin.once("drain", markDrained);
    }
  });
}

async function smokeWindowsBackendAttempt(launch, input, baseDir) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const reserved = await reservePort();
  const port = reserved.port;
  // Close the reservation immediately before spawn. The close-to-bind gap is
  // a TOCTOU on a busy Windows agent; the caller retries EADDRINUSE.
  await reserved.release();
  const bootstrapToken = NodeCrypto.randomBytes(24).toString("hex");
  const envelope = {
    mode: "desktop",
    noBrowser: true,
    port,
    t3Home: baseDir,
    host: "127.0.0.1",
    desktopBootstrapToken: bootstrapToken,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  };
  const env = inheritSparseEnv();
  if (launch.electronAsNode) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  delete env.ELECTRON_NO_ASAR;
  delete env.NODE_OPTIONS;

  let child;
  let closed;
  let output = "";

  try {
    child = NodeChildProcess.spawn(
      launch.executablePath,
      [
        launch.entryPath,
        "--bootstrap-fd",
        "0",
        "--mode",
        "desktop",
        "--no-browser",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--base-dir",
        baseDir,
      ],
      {
        cwd: launch.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    closed = NodeEvents.once(child, "close");
    await writeBootstrapEnvelope(child.stdin, envelope);
    const bindFailed = new Promise((_, reject) => {
      const failIfAddressInUse = () => {
        if (isAddressInUseOutput(output)) reject(new AddressInUseError(port));
      };
      for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => {
          output = (output + chunk.toString()).slice(-16_384);
          failIfAddressInUse();
        });
      }
    });
    const exited = closed.then(([code, signal]) => {
      if (isAddressInUseOutput(output)) throw new AddressInUseError(port);
      throw new Error(`Packaged backend exited before readiness (code=${code}, signal=${signal}).`);
    });
    const controller = new AbortController();
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(
          new Error(
            `Packaged backend did not become ready within ${Math.floor(timeoutMs / 1000)} seconds.`,
          ),
        );
        controller.abort();
      }, timeoutMs);
    });
    const proveReady = async () => {
      await waitForEnvironment(port, controller.signal);
      await exchangeLocalBearer(port, bootstrapToken, controller.signal);
    };
    const pollReady = (async () => {
      while (!controller.signal.aborted) {
        try {
          await proveReady();
          return;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          if (isAddressInUseOutput(output)) throw new AddressInUseError(port);
          try {
            await NodeTimersPromises.setTimeout(100, undefined, { signal: controller.signal });
          } catch {
            throw error;
          }
        }
      }
    })();
    const race = [pollReady, exited, bindFailed, deadline];
    for (const candidate of race) {
      void candidate.catch(() => {});
    }
    try {
      await Promise.race(race);
      console.log(
        "Packaged Windows backend reached environment readiness and minted a local bearer.",
      );
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  } catch (error) {
    if (!(error instanceof AddressInUseError)) console.error(output);
    throw error;
  } finally {
    if (child && closed && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        closed.catch(() => {}),
        NodeTimersPromises.setTimeout(5_000, undefined, { ref: false }),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed.catch(() => {});
    }
  }
}

export async function smokeWindowsBackend(input) {
  const launch = input.packagedAppDir
    ? resolvePackagedLaunch(input)
    : {
        executablePath: NodePath.resolve(input.executablePath),
        entryPath: NodePath.resolve(input.entryPath),
        cwd: NodePath.dirname(NodePath.resolve(input.entryPath)),
        electronAsNode: input.electronAsNode === true,
      };
  const baseDir = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "t3-windows-backend-smoke-"),
  );
  try {
    let lastError;
    for (let attempt = 1; attempt <= BIND_RETRY_LIMIT; attempt += 1) {
      try {
        await smokeWindowsBackendAttempt(launch, input, baseDir);
        return;
      } catch (error) {
        lastError = error;
        if (!(error instanceof AddressInUseError) || attempt === BIND_RETRY_LIMIT) {
          throw error;
        }
      }
    }
    throw lastError;
  } finally {
    await NodeFSP.rm(baseDir, { recursive: true, force: true });
  }
}

const SMOKE_SCRIPT_NAME = "smoke-windows-backend.mjs";

export function isInvokedAsCli(argv1 = process.argv[1], moduleUrl = import.meta.url) {
  if (argv1 === undefined || argv1.length === 0) return false;
  // Node's host basename is not enough: Windows CI paths use `\`, and this
  // script is also unit-tested on POSIX. Split on either separator.
  const scriptName = argv1.split(/[\\/]/u).pop()?.toLowerCase();
  if (scriptName === SMOKE_SCRIPT_NAME) return true;
  try {
    const invoked = decodeURIComponent(
      NodeURL.pathToFileURL(NodePath.resolve(argv1)).href,
    ).toLowerCase();
    const self = decodeURIComponent(moduleUrl).toLowerCase();
    return invoked === self;
  } catch {
    return false;
  }
}

if (isInvokedAsCli()) {
  await smokeWindowsBackend(parseArgs(process.argv.slice(2)));
}
