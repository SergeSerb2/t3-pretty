import { createRequire } from "node:module";

import { assert, describe, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  PHASE_NAME,
  addWidgetVersionSync,
  findApplicationTargetName,
  versionSyncScript,
} = require("./addWidgetVersionSync.cjs");

function makeProject() {
  const phases = [];
  const objects = {
    PBXNativeTarget: {
      APP: {
        name: "T3Pretty",
        productType: "com.apple.product-type.application",
        buildPhases: [],
      },
      WIDGET: {
        name: "ExpoWidgetsTarget",
        productType: "com.apple.product-type.app-extension",
        buildPhases: phases,
      },
    },
    PBXShellScriptBuildPhase: {},
  };
  return {
    objects,
    phases,
    proj: {
      hash: { project: { objects } },
      addBuildPhase(_files, _type, name, targetUuid, opts) {
        const uuid = "PHASE1";
        objects.PBXShellScriptBuildPhase[uuid] = {
          name: `"${name}"`,
          shellScript: opts.shellScript,
        };
        phases.push({ value: uuid });
        return { uuid };
      },
    },
  };
}

describe("addWidgetVersionSync", () => {
  it("finds the application target name", () => {
    const { objects } = makeProject();
    assert.equal(findApplicationTargetName(objects, "ExpoWidgetsTarget"), "T3Pretty");
  });

  it("copies parent store versions onto the built widget plist", () => {
    const script = versionSyncScript("T3Pretty");
    assert.include(script, "${SRCROOT}/T3Pretty/Info.plist");
    assert.include(script, "CFBundleVersion");
    assert.include(script, "CFBundleShortVersionString");
    assert.include(script, "PlistBuddy");
    assert.include(script, "TARGET_BUILD_DIR");
  });

  it("adds an always-out-of-date phase once", () => {
    const { proj, objects } = makeProject();
    assert.equal(addWidgetVersionSync(proj, { targetName: "ExpoWidgetsTarget" }), true);
    assert.equal(addWidgetVersionSync(proj, { targetName: "ExpoWidgetsTarget" }), false);
    const phase = objects.PBXShellScriptBuildPhase.PHASE1;
    assert.equal(phase.name, `"${PHASE_NAME}"`);
    assert.equal(phase.alwaysOutOfDate, 1);
    assert.include(phase.shellScript, "${SRCROOT}/T3Pretty/Info.plist");
  });
});
