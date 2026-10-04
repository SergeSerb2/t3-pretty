import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const pipeline = NodeFS.readFileSync(
  new NodeURL.URL("../../.buildkite/pipeline.yml", import.meta.url),
  "utf8",
);
const steps = pipeline.split(/(?=^  - label:)/mu).filter((block) => block.startsWith("  - label:"));

describe("one-run iOS pipeline selection", () => {
  it("excludes every non-iOS step only when the optional selector is enabled", () => {
    const others = steps.filter((block) => !/^    key: ios-mobile$/mu.test(block));
    assert.isAbove(others.length, 0);
    for (const block of others) {
      assert.match(block, /^    if:[^\n]*\n(?:      )?(?:[^\n]*\n)*?/mu);
      assert.include(block, 'build.env("T3CODE_IOS_ONLY") != "1"');
    }
  });

  it("keeps the existing Mac iOS release and permanent daily cap", () => {
    const ios = steps.filter((block) => /^    key: ios-mobile$/mu.test(block));
    assert.equal(ios.length, 1);
    assert.notInclude(ios[0], 'build.env("T3CODE_IOS_ONLY")');
    assert.include(ios[0], 'if: build.branch == "main" && build.source != "schedule"');
    assert.include(ios[0], "queue: macos-release");
    assert.include(ios[0], "os: macos");
    assert.include(ios[0], 'T3CODE_IOS_ALLOW_EAS_CLOUD: "1"');
    assert.include(ios[0], 'concurrency_group: "t3-pretty/ios-mobile"');
    assert.include(ios[0], "node scripts/fork/run-publish-mobile-release.mjs");
    assert.notInclude(pipeline, "T3CODE_IOS_EXPO_DAILY_LIMIT:");
    assert.notInclude(ios[0], "T3CODE_FORCE_IOS");
  });
});
