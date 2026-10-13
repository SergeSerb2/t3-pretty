import { boundDiagnosticText, diagnosticConsoleText } from "../DiagnosticText.ts";

const mode = process.argv[2];
function produce() {
  const source = `${mode}:` + "x".repeat(64 * 1024 * 1024);
  source.charCodeAt(source.length - 1);
  if (mode === "console-full-budget") {
    return diagnosticConsoleText([{ value: source.slice(0, 16_384) }, null]);
  }
  if (mode === "console-overflow-prefix") {
    return diagnosticConsoleText([{ value: source.slice(0, 16_378) }, "overflowing"]);
  }
  if (mode === "console-short-prefix") {
    return diagnosticConsoleText([{ value: source.slice(0, 2_048) }]);
  }
  if (mode === "console-earlier-prefix") {
    return diagnosticConsoleText([{ value: source.slice(0, 2_048) }, { value: source }]);
  }
  if (mode === "bound-short-prefix") {
    return boundDiagnosticText(source.slice(0, 2_048), 4_096);
  }
  throw new Error(`Unknown fixture mode: ${mode}`);
}

global.gc();
const baseline = process.memoryUsage().heapUsed;
const output = produce();
for (let index = 0; index < 8; index++) {
  await new Promise(setImmediate);
  global.gc();
}
console.log(
  JSON.stringify({
    outputLength: output.length,
    retainedBytes: process.memoryUsage().heapUsed - baseline,
  }),
);
