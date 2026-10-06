// @effect-diagnostics nodeBuiltinImport:off - memory assertions run in an isolated Node process with explicit GC.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

it.each(["native", "delegate"])(
  "releases traced client results while cached lookup fibers remain alive (%s)",
  async (mode) => {
    const root = NodeURL.fileURLToPath(new URL("../../../../", import.meta.url));
    const fixture = NodeURL.fileURLToPath(
      new URL("./testkit/ClientTraceRetention.fixture.mjs", import.meta.url),
    );
    const { stdout } = await execFile(process.execPath, ["--expose-gc", fixture, root, mode]);
    const result = JSON.parse(stdout) as { cacheSize: number; retained: number; ended: number };
    expect(result.cacheSize).toBe(4);
    expect(result.ended).toBe(4);
    expect(result.retained).toBe(0);
  },
);
