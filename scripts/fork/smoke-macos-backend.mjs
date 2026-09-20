#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeURL from "node:url";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const OUTPUT_TAIL_BYTES = 16_384;
export const MAX_FAILURE_LINE_BYTES = 2_048;

const SMOKE_SCRIPT_NAME = "smoke-macos-backend.mjs";

export function advertisedListenNeedle(port) {
  return `Listening on http://127.0.0.1:${port}`;
}

export function retainUsefulChildOutput(current, chunk, limit = OUTPUT_TAIL_BYTES) {
  const lines = `${current}${chunk}`.split(/\r?\n/u);
  const kept = [];
  for (const line of lines) {
    if (line.length > MAX_FAILURE_LINE_BYTES) {
      kept.push(`[dropped ${String(line.length)}-byte minified source line]`);
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n").slice(-limit);
}

export function exitedBeforeReadinessMessage(code, signal, output) {
  const diagnostic = retainUsefulChildOutput("", output);
  return `Packaged backend exited before readiness (code=${code}, signal=${signal}).${
    diagnostic.length > 0 ? `\n${diagnostic}` : ""
  }`;
}

export function readyTimeoutMessage(timeoutMs) {
  return `Packaged backend did not become ready within ${Math.floor(timeoutMs / 1000)} seconds.`;
}

export function isInvokedAsCli(argv1 = process.argv[1], moduleUrl = import.meta.url) {
  if (argv1 === undefined || argv1.length === 0) return false;
  const scriptName = argv1.split(/[\\/]/u).pop()?.toLowerCase();
  if (scriptName === SMOKE_SCRIPT_NAME) return true;
  try {
    const invoked = decodeURIComponent(NodeURL.pathToFileURL(NodePath.resolve(argv1)).href);
    return invoked === decodeURIComponent(moduleUrl);
  } catch {
    return false;
  }
}

async function resolvePackagedLaunch(appPath) {
  const contents = NodePath.join(NodePath.resolve(appPath), "Contents");
  const executable = NodeChildProcess.execFileSync(
    "/usr/bin/plutil",
    ["-extract", "CFBundleExecutable", "raw", "-o", "-", NodePath.join(contents, "Info.plist")],
    { encoding: "utf8" },
  ).trim();
  return {
    executablePath: NodePath.join(contents, "MacOS", executable),
    entryPath: NodePath.join(
      contents,
      "Resources",
      "app.asar",
      "apps",
      "server",
      "dist",
      "bin.mjs",
    ),
    electronAsNode: true,
  };
}

async function reservePort() {
  const reservation = NodeNet.createServer();
  reservation.listen(0, "127.0.0.1");
  await NodeEvents.once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export async function smokeMacosBackend(input) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const launch = input.appPath
    ? await resolvePackagedLaunch(input.appPath)
    : {
        executablePath: NodePath.resolve(input.executablePath),
        entryPath: NodePath.resolve(input.entryPath),
        electronAsNode: input.electronAsNode === true,
      };
  const baseDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-macos-backend-smoke-"));
  let child;
  let closed;
  let output = "";
  let useful = "";

  try {
    const port = await reservePort();
    const env = Object.fromEntries(
      ["PATH", "HOME", "TMPDIR", "LANG", "SHELL"].flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
    );
    if (launch.electronAsNode) env.ELECTRON_RUN_AS_NODE = "1";

    child = NodeChildProcess.spawn(
      launch.executablePath,
      [
        launch.entryPath,
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
        cwd: baseDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    closed = NodeEvents.once(child, "close");
    const listenNeedle = advertisedListenNeedle(port);
    const listening = new Promise((resolve) => {
      const inspectOutput = (buffer) => {
        if (buffer.includes(listenNeedle)) resolve();
      };
      for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => {
          const text = chunk.toString();
          const combined = output + text;
          // Inspect before truncating. A 16KiB+ flush can put Listening at
          // the front and drop it from the retained tail.
          inspectOutput(combined);
          useful = retainUsefulChildOutput(useful, text);
          output = combined.slice(-OUTPUT_TAIL_BYTES);
        });
      }
    });
    const exited = closed.then(([code, signal]) => {
      throw new Error(exitedBeforeReadinessMessage(code, signal, useful || output));
    });
    const controller = new AbortController();
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(readyTimeoutMessage(timeoutMs)));
        controller.abort();
      }, timeoutMs);
    });
    const readiness = listening.then(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`, {
        signal: controller.signal,
      });
      if (!response.ok || typeof (await response.json()).environmentId !== "string") {
        throw new Error("Packaged backend returned an invalid environment descriptor.");
      }
    });
    const race = [readiness, exited, deadline];
    for (const candidate of race) {
      void candidate.catch(() => {});
    }
    try {
      await Promise.race(race);
      console.log("Packaged macOS backend reached environment readiness.");
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  } catch (error) {
    console.error(useful || output);
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
    await NodeFSP.rm(baseDir, { recursive: true, force: true });
  }
}

if (isInvokedAsCli()) {
  const appPath = process.argv[2];
  if (!appPath) throw new Error("Usage: node smoke-macos-backend.mjs <packaged.app>");
  await smokeMacosBackend({ appPath });
}
