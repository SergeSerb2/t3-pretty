/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off - memory assertions run in an isolated process with explicit GC.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

it.each(["cooldown", "idle"])("releases saved snapshots while persistence is %s", async (mode) => {
  const root = NodeURL.fileURLToPath(new URL("../../../../", import.meta.url));
  const fixture = NodeURL.fileURLToPath(
    new URL("./testkit/CachePersistenceRetention.fixture.mjs", import.meta.url),
  );
  const { stdout } = await execFile(process.execPath, ["--expose-gc", fixture, root, mode]);
  expect(JSON.parse(stdout)).toEqual({ persisted: 1, retained: false });
});
