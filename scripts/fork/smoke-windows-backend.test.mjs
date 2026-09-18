import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { DESKTOP_LOCAL_BEARER_TOKEN_TIMEOUT_MS } from "@t3tools/contracts/desktopBearerTimeout";
import { assert, describe, it } from "vite-plus/test";

import {
  AddressInUseError,
  advertisedListenNeedle,
  BIND_RETRY_LIMIT,
  DEFAULT_TIMEOUT_MS,
  isAddressInUseOutput,
  isInvokedAsCli,
  listeningPortFromOutput,
  ListenPortMismatchError,
  readyTimeoutMessage,
  REQUEST_TIMEOUT_MS,
  smokeWindowsBackend,
  writeBootstrapEnvelope,
} from "./smoke-windows-backend.mjs";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

const FAKE_BACKEND_SOURCE = `import * as NodeHttp from "node:http";
import * as NodeReadline from "node:readline";

const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
let envelope = null;
const pending = [];

const rl = NodeReadline.createInterface({ input: process.stdin });
rl.once("line", (line) => {
  envelope = JSON.parse(line);
  for (const resolve of pending) resolve();
  pending.length = 0;
});

const waitForEnvelope = () =>
  envelope !== null ? Promise.resolve() : new Promise((resolve) => pending.push(resolve));

const server = NodeHttp.createServer((request, response) => {
  if (request.url === "/.well-known/t3/environment") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ environmentId: "smoke-env" }));
    return;
  }
  if (request.method === "POST" && request.url === "/oauth/token") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      void waitForEnvelope().then(() => {
        const params = new URLSearchParams(body);
        if (params.get("subject_token") !== envelope.desktopBootstrapToken) {
          response.statusCode = 401;
          response.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "smoke-bearer-token",
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "orchestration:read",
          }),
        );
      });
    });
    return;
  }
  response.statusCode = 404;
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(\`Listening on http://127.0.0.1:\${port}\`);
});
`;

const DELAYED_HTTP_BACKEND_SOURCE = `import * as NodeHttp from "node:http";
import * as NodeReadline from "node:readline";
import * as NodeTimersPromises from "node:timers/promises";

const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
let envelope = null;
const pending = [];

const rl = NodeReadline.createInterface({ input: process.stdin });
rl.once("line", (line) => {
  envelope = JSON.parse(line);
  for (const resolve of pending) resolve();
  pending.length = 0;
});

const waitForEnvelope = () =>
  envelope !== null ? Promise.resolve() : new Promise((resolve) => pending.push(resolve));

const server = NodeHttp.createServer((request, response) => {
  if (request.url === "/.well-known/t3/environment") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ environmentId: "smoke-env" }));
    return;
  }
  if (request.method === "POST" && request.url === "/oauth/token") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      void waitForEnvelope().then(() => {
        const params = new URLSearchParams(body);
        if (params.get("subject_token") !== envelope.desktopBootstrapToken) {
          response.statusCode = 401;
          response.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "smoke-bearer-token",
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "orchestration:read",
          }),
        );
      });
    });
    return;
  }
  response.statusCode = 404;
  response.end();
});

console.log(\`Listening on http://127.0.0.1:\${port}\`);
await NodeTimersPromises.setTimeout(250);
server.listen(port, "127.0.0.1");
`;

const HANGING_FIRST_REQUEST_BACKEND_SOURCE = `import * as NodeHttp from "node:http";
import * as NodeReadline from "node:readline";

const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
let envelope = null;
const pending = [];
let requests = 0;

const rl = NodeReadline.createInterface({ input: process.stdin });
rl.once("line", (line) => {
  envelope = JSON.parse(line);
  for (const resolve of pending) resolve();
  pending.length = 0;
});

const waitForEnvelope = () =>
  envelope !== null ? Promise.resolve() : new Promise((resolve) => pending.push(resolve));

const server = NodeHttp.createServer((request, response) => {
  requests += 1;
  if (requests === 1) return;
  if (request.url === "/.well-known/t3/environment") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ environmentId: "smoke-env" }));
    return;
  }
  if (request.method === "POST" && request.url === "/oauth/token") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      void waitForEnvelope().then(() => {
        const params = new URLSearchParams(body);
        if (params.get("subject_token") !== envelope.desktopBootstrapToken) {
          response.statusCode = 401;
          response.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "smoke-bearer-token",
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "orchestration:read",
          }),
        );
      });
    });
    return;
  }
  response.statusCode = 404;
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(\`Listening on http://127.0.0.1:\${port}\`);
});
`;

describe("smoke-windows-backend", () => {
  it("exchanges a local bearer after the child listens on the advertised port", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-windows-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(entryPath, FAKE_BACKEND_SOURCE);
    try {
      await smokeWindowsBackend({
        executablePath: process.execPath,
        entryPath,
        timeoutMs: 5_000,
      });
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("retries readiness after Listening prints before HTTP is serving", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-windows-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(entryPath, DELAYED_HTTP_BACKEND_SOURCE);
    try {
      await smokeWindowsBackend({
        executablePath: process.execPath,
        entryPath,
        timeoutMs: 5_000,
      });
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("retries after a hung first HTTP request instead of consuming the whole budget", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-windows-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(entryPath, HANGING_FIRST_REQUEST_BACKEND_SOURCE);
    const started = Date.now();
    try {
      await smokeWindowsBackend({
        executablePath: process.execPath,
        entryPath,
        timeoutMs: 5_000,
      });
      assert.isBelow(Date.now() - started, 4_000);
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("still sees Listening when it arrives at the front of a large stdio flush", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-windows-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(
      entryPath,
      FAKE_BACKEND_SOURCE.replace(
        "console.log(`Listening on http://127.0.0.1:${port}`);",
        'process.stdout.write(`Listening on http://127.0.0.1:${port}\\n${"x".repeat(20_000)}\\n`);',
      ),
    );
    const started = Date.now();
    try {
      await smokeWindowsBackend({
        executablePath: process.execPath,
        entryPath,
        timeoutMs: 5_000,
      });
      assert.isBelow(Date.now() - started, 4_000);
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails fast when the child listens on a different port than reserved", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-windows-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(
      entryPath,
      "console.log('Listening on http://127.0.0.1:1');\nsetInterval(() => {}, 1000);\n",
    );
    const started = Date.now();
    try {
      let error;
      try {
        await smokeWindowsBackend({
          executablePath: process.execPath,
          entryPath,
          timeoutMs: 5_000,
        });
      } catch (caught) {
        error = caught;
      }
      assert.instanceOf(error, ListenPortMismatchError);
      assert.isAbove(error.reservedPort, 1);
      assert.equal(error.listenedPort, 1);
      assert.isBelow(Date.now() - started, 4_000);
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reports listen status when the ready budget expires", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-windows-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(entryPath, "setInterval(() => {}, 1000);\n");
    try {
      let message = "";
      try {
        await smokeWindowsBackend({
          executablePath: process.execPath,
          entryPath,
          timeoutMs: 1_200,
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert.match(message, /did not become ready within 1 seconds/u);
      assert.include(message, "listen=missing");
      assert.include(message, "no HTTP probe error yet");
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("runs the smoke when invoked as a CLI instead of no-op exiting 0", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-windows-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(entryPath, FAKE_BACKEND_SOURCE);
    try {
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [
          NodePath.resolve(here, "smoke-windows-backend.mjs"),
          "--executable",
          process.execPath,
          "--entry",
          entryPath,
          "--timeout-ms",
          "5000",
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.include(result.stdout, "advertised listen");
      assert.include(result.stdout, "reached environment readiness");
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("detects CLI invocation from basename when Windows file URLs disagree", () => {
    assert.equal(
      isInvokedAsCli(
        "C:\\Users\\build\\scripts\\fork\\smoke-windows-backend.mjs",
        "file:///c:/Users/build/scripts/fork/smoke-windows-backend.mjs",
      ),
      true,
    );
    assert.equal(
      isInvokedAsCli(
        "C:\\Users\\build\\scripts\\fork\\Smoke-Windows-Backend.mjs",
        "file:///C:/Users/build/scripts/fork/other.mjs",
      ),
      true,
    );
  });

  it("falls back to a normalized file URL when the basename is remapped", () => {
    const argv1 = "/tmp/t3-windows-smoke-wrapper.mjs";
    const moduleUrl = NodeURL.pathToFileURL(NodePath.resolve(argv1)).href;
    assert.equal(isInvokedAsCli(argv1, moduleUrl), true);
    assert.equal(isInvokedAsCli(argv1, moduleUrl.replace("file://", "FILE://")), true);
  });

  it("does not treat an imported module as a CLI", () => {
    assert.equal(isInvokedAsCli(undefined, import.meta.url), false);
    assert.equal(isInvokedAsCli("", import.meta.url), false);
    assert.equal(isInvokedAsCli("/tmp/build-desktop-artifact.ts", import.meta.url), false);
    assert.equal(
      isInvokedAsCli(
        "C:\\Users\\build\\scripts\\fork\\build-desktop-artifact.ts",
        "file:///c:/Users/build/scripts/fork/smoke-windows-backend.mjs",
      ),
      false,
    );
  });

  it("fails fast when the bootstrap envelope cannot be written to stdin", async () => {
    const envelope = { desktopBootstrapToken: "token" };
    const makeStdin = (behavior) => {
      const handlers = { error: [], drain: [] };
      const stdin = {
        ended: false,
        once(event, handler) {
          if (event === "error" || event === "drain") handlers[event].push(handler);
        },
        off(event, handler) {
          if (event === "error" || event === "drain") {
            handlers[event] = handlers[event].filter((candidate) => candidate !== handler);
          }
        },
        write(chunk, callback) {
          if (behavior === "error-event") {
            queueMicrotask(() => {
              for (const handler of handlers.error) handler(new Error("EPIPE"));
            });
            return true;
          }
          if (behavior === "write-error") {
            queueMicrotask(() => callback(new Error("EACCES")));
            return true;
          }
          if (behavior === "backpressure") {
            queueMicrotask(() => callback());
            queueMicrotask(() => {
              for (const handler of handlers.drain) handler();
            });
            return false;
          }
          queueMicrotask(() => callback());
          return true;
        },
        end(callback) {
          stdin.ended = true;
          queueMicrotask(() => callback());
        },
      };
      return stdin;
    };

    const ok = makeStdin("ok");
    await writeBootstrapEnvelope(ok, envelope);
    assert.equal(ok.ended, true);

    const backpressured = makeStdin("backpressure");
    await writeBootstrapEnvelope(backpressured, envelope);
    assert.equal(backpressured.ended, true);

    let writeMessage = "";
    try {
      await writeBootstrapEnvelope(makeStdin("write-error"), envelope);
    } catch (error) {
      writeMessage = error instanceof Error ? error.message : String(error);
    }
    assert.match(writeMessage, /EACCES/u);

    let pipeMessage = "";
    try {
      await writeBootstrapEnvelope(makeStdin("error-event"), envelope);
    } catch (error) {
      pipeMessage = error instanceof Error ? error.message : String(error);
    }
    assert.match(pipeMessage, /EPIPE/u);

    let missingMessage = "";
    try {
      await writeBootstrapEnvelope(null, envelope);
    } catch (error) {
      missingMessage = error instanceof Error ? error.message : String(error);
    }
    assert.match(missingMessage, /stdin is not writable/u);
  });

  it("retries when the reserved port is stolen before the child binds", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-windows-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    const markerPath = NodePath.join(tempDir, "first-bind");
    await NodeFSP.writeFile(
      entryPath,
      `import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
const marker = NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "first-bind");
if (!NodeFS.existsSync(marker)) {
  NodeFS.writeFileSync(marker, "1");
  console.error("Error: listen EADDRINUSE: address already in use 127.0.0.1:9");
  process.exit(1);
}
${FAKE_BACKEND_SOURCE}`,
    );
    try {
      await smokeWindowsBackend({
        executablePath: process.execPath,
        entryPath,
        timeoutMs: 5_000,
      });
      assert.equal(NodeFS.existsSync(markerPath), true);
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails fast after bind retries when the port stays busy", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-windows-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(
      entryPath,
      "console.error('Error: listen EADDRINUSE: address already in use 127.0.0.1:9'); process.exit(1);\n",
    );
    const started = Date.now();
    try {
      let error;
      try {
        await smokeWindowsBackend({
          executablePath: process.execPath,
          entryPath,
          timeoutMs: 5_000,
        });
      } catch (caught) {
        error = caught;
      }
      assert.instanceOf(error, AddressInUseError);
      assert.isBelow(Date.now() - started, 4_000);
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("treats Node EADDRINUSE text as a stolen reserved port", () => {
    assert.equal(isAddressInUseOutput("Error: listen EADDRINUSE: address already in use"), true);
    assert.equal(isAddressInUseOutput("address already in use :::443"), true);
    assert.equal(isAddressInUseOutput("Listening on http://127.0.0.1:9"), false);
    assert.equal(BIND_RETRY_LIMIT, 5);
  });

  it("parses the advertised listen port and formats ready timeouts", () => {
    assert.equal(advertisedListenNeedle(64661), "Listening on http://127.0.0.1:64661");
    assert.equal(listeningPortFromOutput("Listening on http://127.0.0.1:64661"), 64661);
    assert.equal(listeningPortFromOutput("still starting"), null);
    assert.equal(REQUEST_TIMEOUT_MS, 1_000);
    assert.equal(
      readyTimeoutMessage(100_000, { sawListen: true, lastError: new Error("fetch failed") }),
      "Packaged backend did not become ready within 100 seconds. listen=seen; lastError=fetch failed",
    );
    assert.equal(
      readyTimeoutMessage(1_200, {}),
      "Packaged backend did not become ready within 1 seconds. listen=missing; lastError=no HTTP probe error yet",
    );
  });

  it("fails when the packaged child exits before listen", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-windows-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(entryPath, "console.error('boom'); process.exit(7);\n");
    try {
      let message = "";
      try {
        await smokeWindowsBackend({
          executablePath: process.execPath,
          entryPath,
          timeoutMs: 5_000,
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert.match(message, /exited before readiness/u);
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("is wired as the Windows packaged readiness smoke", () => {
    const artifact = NodeFS.readFileSync(
      NodePath.resolve(here, "../build-desktop-artifact.ts"),
      "utf8",
    );
    const macos = NodeFS.readFileSync(NodePath.resolve(here, "build-macos-dmg.sh"), "utf8");
    assert.include(artifact, "scripts/fork/smoke-windows-backend.mjs");
    assert.include(artifact, "verifyWindowsPackagedBackendReadiness");
    assert.include(artifact, "DESKTOP_LOCAL_BEARER_TOKEN_TIMEOUT_MS");
    assert.include(artifact, '"--timeout-ms"');
    assert.include(macos, "smoke-macos-backend.mjs");
    assert.equal(DEFAULT_TIMEOUT_MS, DESKTOP_LOCAL_BEARER_TOKEN_TIMEOUT_MS);
    assert.equal(REQUEST_TIMEOUT_MS, 1_000);
  });
});
