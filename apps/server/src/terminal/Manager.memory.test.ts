// @effect-diagnostics nodeBuiltinImport:off -- The retention check uses an isolated V8 process with GC enabled.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";

it.each(["attach", "metadata", "attach-interrupted", "metadata-interrupted"])(
  "releases buffered output after %s startup",
  async (mode) => {
    const fixture = NodeURL.fileURLToPath(
      new URL("./testkit/AttachBufferRetention.fixture.mjs", import.meta.url),
    );
    const { stdout } = await NodeUtil.promisify(NodeChildProcess.execFile)(process.execPath, [
      "--expose-gc",
      fixture,
      mode,
    ]);
    const result = JSON.parse(stdout) as { retained: boolean };
    expect(result.retained).toBe(false);
  },
);
