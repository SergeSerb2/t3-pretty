import { createRequire } from "node:module";

import { assert, describe, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  PHASE_NAME,
  PHASE_SCRIPT,
  SCRIPT_NAME,
  addWidgetVersionSync,
} = require("./addWidgetVersionSync.cjs");

function makeProject() {
  const phases = [];
  const objects = {
    PBXNativeTarget: {
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
  it("keeps the pbxproj phase to a Nanaimo-safe bash one-liner", () => {
    assert.include(PHASE_SCRIPT, `ExpoWidgetsTarget/${SCRIPT_NAME}`);
    assert.notInclude(PHASE_SCRIPT, "PlistBuddy");
    assert.notInclude(PHASE_SCRIPT, ' -c "');
  });

  it("adds an always-out-of-date phase once", () => {
    const { proj, objects } = makeProject();
    assert.equal(addWidgetVersionSync(proj, { targetName: "ExpoWidgetsTarget" }), true);
    assert.equal(addWidgetVersionSync(proj, { targetName: "ExpoWidgetsTarget" }), false);
    const phase = objects.PBXShellScriptBuildPhase.PHASE1;
    assert.equal(phase.name, `"${PHASE_NAME}"`);
    assert.equal(phase.alwaysOutOfDate, 1);
    assert.equal(phase.shellScript, PHASE_SCRIPT);
  });
});
