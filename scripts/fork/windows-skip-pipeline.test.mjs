import * as NodeFS from "node:fs";
import { assert, describe, it } from "vite-plus/test";

const pipeline = NodeFS.readFileSync(new URL("../../.buildkite/pipeline.yml", import.meta.url), "utf8");
const steps = pipeline.split(/(?=^  - label:)/mu).filter((block) => block.startsWith("  - label:"));
const windows = steps.find((block) => /^    key: windows-nsis$/mu.test(block));
const expression = /^    if: '(.+)'$/mu.exec(windows)?.[1];
const selected = (branch, source, env = {}) => Function("build", `return (${expression});`)({
  branch, source, env: (key) => env[key],
});

describe("per-build Windows release selection", () => {
  it("keeps ordinary releases enabled and skips only when explicitly selected", () => {
    assert.isTrue(selected("main", "api"));
    assert.isTrue(selected("main", "webhook", { T3CODE_SKIP_WINDOWS: "0" }));
    assert.isFalse(selected("main", "api", { T3CODE_SKIP_WINDOWS: "1" }));
    assert.isFalse(selected("main", "schedule"));
    assert.isFalse(selected("feature", "api"));
    assert.isFalse(selected("main", "api", { T3CODE_IOS_ONLY: "1" }));
  });
  it("preserves the Windows target and queue and leaves other steps untouched", () => {
    assert.include(windows, "queue: windows-release");
    assert.include(windows, "scripts/fork/build-windows-nsis.ps1");
    for (const step of steps.filter((block) => block !== windows)) {
      assert.notInclude(step, "T3CODE_SKIP_WINDOWS");
    }
  });
});
