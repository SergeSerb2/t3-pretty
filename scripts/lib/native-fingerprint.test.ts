// @effect-diagnostics nodeBuiltinImport:off
// The isolated Node process must use its native TypeScript loader, not Vitest's transform.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { assert, it } from "@effect/vitest";

const fixture = NodeURL.fileURLToPath(
  new URL("./testkit/NativeFingerprintLoader.fixture.mjs", import.meta.url),
);
const repoRoot = NodeURL.fileURLToPath(new URL("../..", import.meta.url));

function probe(mode: string, timeout = 10_000) {
  return NodeChildProcess.execFileSync(
    process.execPath,
    ["--no-global-search-paths", fixture, repoRoot, mode],
    { encoding: "utf8", timeout },
  ).trim();
}

it("captures explicit TypeScript config imports without disabling Node type stripping", () => {
  assert.equal(probe("typescript"), "native TypeScript imports captured");
});

it("preserves the compiler receiver, return value, and every argument", () => {
  assert.equal(probe("forwarding"), "compiler contract preserved");
});

it("loads the native file and app major-version fingerprint configuration", () => {
  assert.equal(probe("configuration"), "native fingerprint configuration loaded");
});

it("hashes local native sources with external Gradle plugins without hashing build outputs or other platforms", () => {
  assert.equal(probe("native-sources", 45_000), "native sources and platform boundaries preserved");
});
