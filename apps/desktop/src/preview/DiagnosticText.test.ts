// @effect-diagnostics nodeBuiltinImport:off -- The allocation check needs an isolated V8 process with GC enabled.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { expect, it } from "vite-plus/test";

import { boundDiagnosticText, diagnosticConsoleText } from "./DiagnosticText.ts";

it.each([
  ["console-full-budget", 16_384],
  ["console-overflow-prefix", 16_384],
  ["console-short-prefix", 2_048],
  ["console-earlier-prefix", 16_384],
  ["bound-short-prefix", 2_048],
] as const)("releases a larger source behind a bounded %s string", async (mode, outputLength) => {
  const fixture = NodeURL.fileURLToPath(
    new URL("./testkit/DiagnosticTextRetention.fixture.mjs", import.meta.url),
  );
  const { stdout } = await NodeUtil.promisify(NodeChildProcess.execFile)(process.execPath, [
    "--expose-gc",
    fixture,
    mode,
  ]);
  const result = JSON.parse(stdout) as { outputLength: number; retainedBytes: number };
  expect(result.outputLength).toBe(outputLength);
  expect(result.retainedBytes).toBeLessThan(8 * 1024 * 1024);
});

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

it("keeps a label's truncation boundary between complete Unicode characters", () => {
  const prefix = "x".repeat(115);
  const output = boundDiagnosticText(prefix + "😀" + "tail".repeat(32), 128);
  expect(output).toBe(prefix + " [truncated]");
  expect(output.isWellFormed()).toBe(true);
});

it.each([0, 1, 4, 11, 12, 13])("keeps a diagnostic within a %i-character budget", (limit) => {
  const output = boundDiagnosticText("x".repeat(1024), limit);
  expect(output.length).toBe(limit);
  expect(output).toBe(limit > 12 ? "x [truncated]" : " [truncated]".slice(0, limit));
});

it.each(["first", "later", "full"] as const)(
  "keeps Unicode characters complete when truncating a %s console argument",
  (position) => {
    const prefixLimit = 16_384 - " [truncated]".length;
    const prefix = "x".repeat(prefixLimit - (position === "later" ? 3 : 1));
    const input = prefix + "😀" + "z".repeat(64);
    const args =
      position === "later"
        ? [{ value: "p" }, { value: input }]
        : position === "full"
          ? [{ value: (input + "z".repeat(16_384)).slice(0, 16_384) }, { value: "next" }]
          : [{ value: input }];
    const output = diagnosticConsoleText(args);
    expect(output).toBe((position === "later" ? "p " : "") + prefix + " [truncated]");
    expect(output.isWellFormed()).toBe(true);
  },
);
