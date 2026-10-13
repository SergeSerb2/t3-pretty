import { diagnosticConsoleText } from "../DiagnosticText.ts";

const large = "x".repeat(64 * 1024 * 1024);
// Materialize the input before measuring allocations made by diagnostics.
large.charCodeAt(large.length - 1);
global.gc();
const before = process.memoryUsage().heapUsed;
const output = diagnosticConsoleText([{ value: "first" }, { value: large }]);
const allocatedBytes = process.memoryUsage().heapUsed - before;
console.log(JSON.stringify({ outputLength: output.length, allocatedBytes }));
