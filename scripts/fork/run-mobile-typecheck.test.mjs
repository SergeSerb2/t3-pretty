import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const pipeline = NodeFS.readFileSync(
  new URL("../../.buildkite/pipeline.yml", import.meta.url),
  "utf8",
);
const script = NodeFS.readFileSync(NodePath.join(here, "run-mobile-typecheck.sh"), "utf8");
const steps = pipeline.split(/(?=^  - label:)/mu).filter((block) => block.startsWith("  - label:"));
const typecheck = steps.find((block) => /^    key: mobile-typecheck$/mu.test(block));

describe("mobile typecheck PR gate", () => {
  it("runs the apps/mobile typecheck after a frozen mobile-graph install", () => {
    assert.include(script, 'source "$ROOT/scripts/fork/ensure-vite-plus.sh"');
    assert.include(script, 'ensure_vite_plus "to typecheck mobile"');
    assert.include(script, "vp i --frozen-lockfile --filter @t3tools/mobile...");
    assert.include(script, "vp run --filter @t3tools/mobile typecheck");
    assert.notInclude(script, "FORCE_IOS");
    assert.notInclude(script, "T3CODE_FORCE_IOS");
    assert.notInclude(script, "eas build");
    assert.notInclude(script, "eas update");
  });

  it("runs on PR branches so packaging skips cannot hide mobile type drift", () => {
    assert.isString(typecheck);
    assert.include(typecheck, "bash scripts/fork/run-mobile-typecheck.sh");
    assert.match(typecheck, /build\.branch != "main"/u);
    assert.notInclude(typecheck, 'build.branch == "main"');
    assert.include(typecheck, 'build.env("T3CODE_IOS_ONLY") != "1"');
    assert.include(typecheck, "queue: macos-release");
    assert.include(typecheck, "os: macos");
  });
});
