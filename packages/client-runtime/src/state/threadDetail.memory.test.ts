/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off - memory assertions run in an isolated Node process with explicit GC.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

it.each([
  "threadAtom",
  "visibleTurnItemsAtom",
  "queueWorkflowAtom",
  "queuedCountAtom",
  "turnSubagentsAtom",
  "pendingRequestsAtom",
])("releases %s data after eviction while its definitions remain alive", async (mode) => {
  const root = NodeURL.fileURLToPath(new URL("../../../../", import.meta.url));
  const fixture = NodeURL.fileURLToPath(
    new URL("./testkit/ThreadDetailRetention.fixture.mjs", import.meta.url),
  );
  const { stdout } = await execFile(process.execPath, ["--expose-gc", fixture, root, mode]);
  const result = JSON.parse(stdout) as {
    checkpoints: ReadonlyArray<{ definitions: number; retained: number }>;
  };
  expect(result.checkpoints).toEqual([
    { definitions: 4, retained: 0 },
    { definitions: 8, retained: 0 },
  ]);
});
