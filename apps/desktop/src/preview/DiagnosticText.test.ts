// @effect-diagnostics nodeBuiltinImport:off -- The allocation check needs an isolated V8 process with GC enabled.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";

import { diagnosticConsoleText } from "./DiagnosticText.ts";

it("bounds temporary allocations before joining an oversized later console argument", async () => {
  const fixture = NodeURL.fileURLToPath(
    new URL("./testkit/DiagnosticTextAllocation.fixture.mjs", import.meta.url),
  );
  const { stdout } = await NodeUtil.promisify(NodeChildProcess.execFile)(process.execPath, [
    "--expose-gc",
    fixture,
  ]);
  const result = JSON.parse(stdout) as { outputLength: number; allocatedBytes: number };
  expect(result.outputLength).toBe(16_384);
  expect(result.allocatedBytes).toBeLessThan(1_048_576);
});

it("stops reading later values once the console text budget is full", () => {
  const later = {
    get value() {
      throw new Error("Read a value past the console text budget");
    },
  };
  const output = diagnosticConsoleText([{ value: "x".repeat(16_384) }, later]);
  expect(output.length).toBe(16_384);
  expect(output.endsWith(" [truncated]")).toBe(true);
});

it("keeps spacing and UTF-16 text for ordinary console arguments", () => {
  expect(diagnosticConsoleText([{ value: "" }, { value: "🛠️ café" }, null])).toBe(" 🛠️ café null");
});
