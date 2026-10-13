/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off - memory assertions run in an isolated process with explicit GC.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

it.each(["dispose", "idle", "signal"])(
  "releases query data and signals after registry %s",
  async (mode) => {
    const root = NodeURL.fileURLToPath(new URL("../../../../", import.meta.url));
    const fixture = NodeURL.fileURLToPath(
      new URL("./testkit/QueryFallbackRetention.fixture.mjs", import.meta.url),
    );
    const { stdout } = await execFile(process.execPath, ["--expose-gc", fixture, root, mode]);
    expect(JSON.parse(stdout)).toEqual({
      payloads: 1,
      retained: 0,
      definitionRetained: true,
      retainedSignals: 0,
    });
  },
);
