// @effect-diagnostics nodeBuiltinImport:off - Fixtures launch real child processes to verify the release smoke boundary.
import type * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, expect, it } from "vite-plus/test";

import {
  buildSmokeEnvironment,
  redactServerOutput,
  smokeServerBundle,
  stopChild,
} from "./smoke-bundle.ts";

const withFixture = async (
  source: string,
  run: (input: { readonly entryPath: string; readonly cwd: string }) => Promise<void>,
) => {
  const cwd = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-server-smoke-test-"));
  const entryPath = NodePath.join(cwd, "fixture.mjs");
  await NodeFS.writeFile(entryPath, source);
  try {
    await run({ entryPath, cwd });
  } finally {
    await NodeFS.rm(cwd, { recursive: true, force: true });
  }
};

describe("server bundle smoke", () => {
  it("accepts a bundle only after its environment endpoint is ready", async () => {
    await withFixture(
      `
        import * as http from "node:http";
        const portIndex = process.argv.indexOf("--port") + 1;
        const port = Number(process.argv[portIndex]);
        http.createServer((_request, response) => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ serverVersion: "fixture" }));
        }).listen(port, "127.0.0.1");
      `,
      ({ entryPath, cwd }) => smokeServerBundle({ entryPath, cwd, timeoutMs: 5_000 }),
    );
  });

  it("reports a child that exits before readiness", async () => {
    await withFixture(
      `
        console.error("fixture exploded");
        process.exitCode = 23;
      `,
      async ({ entryPath, cwd }) => {
        await expect(smokeServerBundle({ entryPath, cwd, timeoutMs: 5_000 })).rejects.toThrow(
          /exited before readiness[\s\S]*fixture exploded/u,
        );
      },
    );
  });

  it("retries a child that loses the loopback bind race", async () => {
    await withFixture(
      `
        import * as fs from "node:fs";
        import * as path from "node:path";
        fs.appendFileSync(path.join(process.cwd(), "attempts"), "attempt\\n");
        const portIndex = process.argv.indexOf("--port") + 1;
        console.error(\`Error: listen EADDRINUSE: address already in use 127.0.0.1:\${process.argv[portIndex]}\`);
        process.exitCode = 1;
      `,
      async ({ entryPath, cwd }) => {
        await expect(smokeServerBundle({ entryPath, cwd, timeoutMs: 5_000 })).rejects.toThrow(
          /EADDRINUSE/u,
        );
        const attempts = (await NodeFS.readFile(NodePath.join(cwd, "attempts"), "utf8"))
          .trim()
          .split("\n");
        assert.lengthOf(attempts, 3);
      },
    );
  });

  it("does not retry an unrelated failure that merely mentions EADDRINUSE", async () => {
    await withFixture(
      `
        import * as fs from "node:fs";
        import * as path from "node:path";
        fs.appendFileSync(path.join(process.cwd(), "attempts"), "attempt\\n");
        console.error("configuration note mentions EADDRINUSE");
        process.exitCode = 1;
      `,
      async ({ entryPath, cwd }) => {
        await expect(smokeServerBundle({ entryPath, cwd, timeoutMs: 5_000 })).rejects.toThrow(
          /exited before readiness[\s\S]*configuration note mentions EADDRINUSE/u,
        );
        const attempts = (await NodeFS.readFile(NodePath.join(cwd, "attempts"), "utf8"))
          .trim()
          .split("\n");
        assert.lengthOf(attempts, 1);
      },
    );
  });

  it("retries a nonstandard EADDRINUSE diagnostic tied to the reserved port", async () => {
    await withFixture(
      `
        import * as fs from "node:fs";
        import * as path from "node:path";
        fs.appendFileSync(path.join(process.cwd(), "attempts"), "attempt\\n");
        const portIndex = process.argv.indexOf("--port") + 1;
        console.error(\`EADDRINUSE while opening reserved port \${process.argv[portIndex]}\`);
        process.exitCode = 1;
      `,
      async ({ entryPath, cwd }) => {
        await expect(smokeServerBundle({ entryPath, cwd, timeoutMs: 5_000 })).rejects.toThrow(
          /EADDRINUSE/u,
        );
        const attempts = (await NodeFS.readFile(NodePath.join(cwd, "attempts"), "utf8"))
          .trim()
          .split("\n");
        assert.lengthOf(attempts, 3);
      },
    );
  });

  it("times out and stops a bundle that never becomes ready", async () => {
    await withFixture(
      `
        setInterval(() => {}, 1_000);
      `,
      async ({ entryPath, cwd }) => {
        await expect(smokeServerBundle({ entryPath, cwd, timeoutMs: 500 })).rejects.toThrow(
          /did not become ready/u,
        );
      },
    );
  });

  it("bounds shutdown even when a child never reports termination", async () => {
    const signals: Array<NodeJS.Signals | undefined> = [];
    const child = {
      exitCode: null,
      signalCode: null,
      kill: (signal?: NodeJS.Signals) => {
        signals.push(signal);
        return true;
      },
    } as unknown as NodeChildProcess.ChildProcess;

    await expect(stopChild(child, new Promise(() => {}), 10)).rejects.toThrow(
      /did not terminate after SIGKILL/u,
    );
    assert.deepEqual(signals, [undefined, "SIGKILL"]);
  });

  it("redacts ephemeral pairing credentials from failure output", () => {
    assert.equal(
      redactServerOutput("Token: secret\nPairing URL: http://example.test/#token=secret\n"),
      "Token: [redacted]\nPairing URL: [redacted]\n",
    );
  });

  it("isolates home and config roots while retaining required platform paths", () => {
    assert.deepEqual(
      buildSmokeEnvironment("/tmp/smoke", {
        PATH: "/usr/bin",
        T3CODE_PORT: "9999",
        VITE_DEV_SERVER_URL: "http://example.test",
      }),
      {
        HOME: "/tmp/smoke",
        NODE_PATH: "",
        PATH: "/usr/bin",
        T3CODE_HOME: "/tmp/smoke",
        TEMP: "/tmp/smoke",
        TMP: "/tmp/smoke",
        TMPDIR: "/tmp/smoke",
        USERPROFILE: "/tmp/smoke",
        XDG_CACHE_HOME: "/tmp/smoke/cache",
        XDG_CONFIG_HOME: "/tmp/smoke/config",
        XDG_DATA_HOME: "/tmp/smoke/data",
      },
    );
  });
});
