import * as NodeFS from "node:fs";
import { assert, describe, it } from "vite-plus/test";

const pipeline = NodeFS.readFileSync(
  new URL("../../.buildkite/pipeline.yml", import.meta.url),
  "utf8",
);
const steps = pipeline.split(/(?=^  - label:)/mu).filter((block) => block.startsWith("  - label:"));
function selected(key, source = "ui", env = {}) {
  const step = steps.find((block) => block.includes(`    key: ${key}\n`));
  const expression =
    /^    if: '(.+)'$/mu.exec(step)?.[1] ?? /^    if: (?!>)(.+)$/mu.exec(step)?.[1];
  return Function(
    "build",
    `return (${expression});`,
  )({
    branch: "main",
    source,
    env: (name) => env[name],
  });
}

describe("selective release retries", () => {
  it("recovers Linux and relay without republishing macOS, CLI or iOS", () => {
    const env = {
      T3CODE_SKIP_MACOS: "1",
      T3CODE_SKIP_IOS: "1",
      T3CODE_SKIP_WINDOWS: "1",
      T3CODE_SKIP_ANDROID: "1",
    };
    for (const source of ["ui", "api"]) {
      for (const key of ["deploy-relay", "linux-appimage", "github-mirror"])
        assert.isTrue(selected(key, source, env), key);
      for (const key of [
        "macos-dmg",
        "publish-cli",
        "ios-mobile",
        "windows-nsis",
        "android-mobile",
      ])
        assert.isFalse(selected(key, source, env), key);
    }
    assert.isTrue(selected("upstream-sync", "schedule", env));
    assert.isTrue(selected("macos-dmg"));
    assert.isTrue(selected("publish-cli"));
    assert.isTrue(selected("ios-mobile"));
  });

  it("selects desktop installers without other delivery or manual sync", () => {
    const env = { T3CODE_DESKTOP_ONLY: "1" };
    for (const source of ["ui", "api"]) {
      for (const key of ["macos-dmg", "linux-appimage", "windows-nsis", "github-mirror"]) {
        assert.isTrue(selected(key, source, env), key);
      }
      for (const key of [
        "ios-mobile",
        "android-mobile",
        "deploy-relay",
        "publish-cli",
        "upstream-sync",
        "origin-workflows",
      ]) {
        assert.isFalse(selected(key, source, env), key);
      }
    }
    assert.isTrue(selected("upstream-sync", "schedule", env));
    assert.isTrue(selected("ios-mobile"));
  });
  it("keeps normal delivery enabled and allows per-run skips", () => {
    assert.isTrue(selected("android-mobile"));
    assert.isTrue(selected("deploy-relay"));
    assert.isFalse(selected("android-mobile", "ui", { T3CODE_SKIP_ANDROID: "1" }));
    assert.isFalse(selected("deploy-relay", "ui", { T3CODE_SKIP_RELAY: "1" }));
    assert.isTrue(
      selected("macos-dmg", "ui", { T3CODE_SKIP_ANDROID: "1", T3CODE_SKIP_RELAY: "1" }),
    );
    assert.isTrue(
      selected("linux-appimage", "ui", { T3CODE_SKIP_ANDROID: "1", T3CODE_SKIP_RELAY: "1" }),
    );
    assert.isTrue(
      selected("publish-cli", "ui", { T3CODE_SKIP_ANDROID: "1", T3CODE_SKIP_RELAY: "1" }),
    );
  });
  it("preserves scheduled sync selection and skips release jobs on schedule", () => {
    assert.isTrue(selected("upstream-sync", "schedule"));
    for (const key of [
      "android-mobile",
      "deploy-relay",
      "macos-dmg",
      "linux-appimage",
      "publish-cli",
    ]) {
      assert.isFalse(selected(key, "schedule"));
    }
  });
});
