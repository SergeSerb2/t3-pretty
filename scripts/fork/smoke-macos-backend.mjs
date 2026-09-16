#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";

const appPath = process.argv[2];
if (!appPath) throw new Error("Usage: node smoke-macos-backend.mjs <packaged.app>");

const contents = NodePath.join(NodePath.resolve(appPath), "Contents");
const executable = NodeChildProcess.execFileSync(
  "/usr/bin/plutil",
  ["-extract", "CFBundleExecutable", "raw", "-o", "-", NodePath.join(contents, "Info.plist")],
  { encoding: "utf8" },
).trim();
const baseDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-macos-backend-smoke-"));
let child;
let closed;
let output = "";

try {
  const reservation = NodeNet.createServer();
  reservation.listen(0, "127.0.0.1");
  await NodeEvents.once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );

  // Run the shipped server with Electron's Node runtime and a disposable home.
  // Never inherit release credentials, live T3 settings, or relay configuration.
  const env = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "SHELL"].flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ),
  );
  child = NodeChildProcess.spawn(
    NodePath.join(contents, "MacOS", executable),
    [
      NodePath.join(contents, "Resources", "app.asar", "apps", "server", "dist", "bin.mjs"),
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
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  closed = NodeEvents.once(child, "close");
  // Attach the rejection handler before starting the HTTP probe.
  const exited = closed.then(([code, signal]) => {
    throw new Error(`Packaged backend exited before readiness (code=${code}, signal=${signal}).`);
  });
  const controller = new AbortController();
  const listening = new Promise((resolve) => {
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-16_384);
        if (output.includes(`Listening on http://127.0.0.1:${port}`)) resolve();
      });
    }
  });
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Packaged backend did not become ready within 30 seconds."));
      controller.abort();
    }, 30_000);
  });
  const readiness = listening.then(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`, {
      signal: controller.signal,
    });
    if (!response.ok || typeof (await response.json()).environmentId !== "string") {
      throw new Error("Packaged backend returned an invalid environment descriptor.");
    }
  });
  try {
    await Promise.race([readiness, exited, deadline]);
    console.log("Packaged macOS backend reached environment readiness.");
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
} catch (error) {
  console.error(output);
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
