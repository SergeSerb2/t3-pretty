import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  advertisedListenNeedle,
  DEFAULT_TIMEOUT_MS,
  exitedBeforeReadinessMessage,
  isInvokedAsCli,
  MAX_FAILURE_LINE_BYTES,
  OUTPUT_TAIL_BYTES,
  readyTimeoutMessage,
  retainUsefulChildOutput,
  smokeMacosBackend,
} from "./smoke-macos-backend.mjs";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

const FAKE_BACKEND_SOURCE = `import * as NodeHttp from "node:http";

const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
const server = NodeHttp.createServer((request, response) => {
  if (request.url === "/.well-known/t3/environment") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ environmentId: "smoke-env" }));
    return;
  }
  response.statusCode = 404;
  response.end();
});
server.listen(port, "127.0.0.1", () => {
  console.log(\`Listening on http://127.0.0.1:\${port}\`);
});
`;

describe("smoke-macos-backend", () => {
  it("drops minified source lines so TypeError survives the diagnostic tail", () => {
    const huge = "item.started" + "x".repeat(OUTPUT_TAIL_BYTES);
    const useful = retainUsefulChildOutput("", `${huge}\nTypeError: (void 0) is not a function\n`);
    assert.notInclude(useful, "item.started");
    assert.include(useful, `[dropped ${String(huge.length)}-byte minified source line]`);
    assert.include(useful, "TypeError: (void 0) is not a function");
    assert.isBelow(useful.length, OUTPUT_TAIL_BYTES);
  });

  it("puts the real crash in the exited-before-readiness message", () => {
    const huge = "x".repeat(MAX_FAILURE_LINE_BYTES + 1);
    const message = exitedBeforeReadinessMessage(
      1,
      null,
      `${huge}\nTypeError: (void 0) is not a function\n`,
    );
    assert.match(message, /exited before readiness \(code=1, signal=null\)/u);
    assert.include(message, "TypeError: (void 0) is not a function");
    assert.notInclude(message, huge);
  });

  it("still sees Listening when it arrives at the front of a large stdio flush", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-macos-smoke-"));
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
      await smokeMacosBackend({
        executablePath: process.execPath,
        entryPath,
        timeoutMs: 5_000,
      });
      assert.isBelow(Date.now() - started, 4_000);
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("surfaces TypeError when the child exits after a huge minified dump", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-macos-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(
      entryPath,
      "process.stderr.write(`${'item.started'.padEnd(20_000, 'x')}\\nTypeError: (void 0) is not a function\\n`);\nprocess.exit(1);\n",
    );
    try {
      let message = "";
      try {
        await smokeMacosBackend({
          executablePath: process.execPath,
          entryPath,
          timeoutMs: 5_000,
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert.match(message, /exited before readiness/u);
      assert.include(message, "TypeError: (void 0) is not a function");
      assert.notInclude(message, "item.startedxxxx");
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts a backend only after its environment endpoint is ready", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-macos-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(entryPath, FAKE_BACKEND_SOURCE);
    try {
      await smokeMacosBackend({
        executablePath: process.execPath,
        entryPath,
        timeoutMs: 5_000,
      });
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("detects CLI invocation on POSIX and Windows paths", () => {
    assert.isTrue(
      isInvokedAsCli(
        NodePath.resolve(here, "smoke-macos-backend.mjs"),
        NodeURL.pathToFileURL(NodePath.resolve(here, "smoke-macos-backend.mjs")).href,
      ),
    );
    assert.isTrue(isInvokedAsCli("C:\\Users\\build\\scripts\\fork\\smoke-macos-backend.mjs"));
    assert.isFalse(isInvokedAsCli("/tmp/t3-macos-smoke-wrapper.mjs"));
  });

  it("is wired as the macOS packaged readiness smoke", () => {
    const macos = NodeFS.readFileSync(NodePath.resolve(here, "build-macos-dmg.sh"), "utf8");
    assert.include(macos, "smoke-macos-backend.mjs");
    assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
    assert.equal(advertisedListenNeedle(1234), "Listening on http://127.0.0.1:1234");
    assert.equal(
      readyTimeoutMessage(DEFAULT_TIMEOUT_MS),
      "Packaged backend did not become ready within 30 seconds.",
    );
    assert.equal(readyTimeoutMessage(5_000), "Packaged backend did not become ready within 5 seconds.");
    assert.equal(readyTimeoutMessage(1_200), "Packaged backend did not become ready within 1 seconds.");
  });

  it("reports the configured timeout when the child never listens", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-macos-smoke-"));
    const entryPath = NodePath.join(tempDir, "bin.mjs");
    await NodeFSP.writeFile(entryPath, "setInterval(() => {}, 60_000);\n");
    try {
      let message = "";
      try {
        await smokeMacosBackend({
          executablePath: process.execPath,
          entryPath,
          timeoutMs: 1_200,
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert.include(message, readyTimeoutMessage(1_200));
      assert.notInclude(message, "within 30 seconds");
    } finally {
      await NodeFSP.rm(tempDir, { recursive: true, force: true });
    }
  });
});
