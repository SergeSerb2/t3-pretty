import { createRequire } from "node:module";

import { assert, describe, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const {
  resolveWidgetBuildNumber,
  syncWidgetReleaseVersions,
} = require("./withWidgetLogoAsset.cjs");

function widgetProject({ appBuildNumber = "27", widgetBuildNumber = "1" } = {}) {
  return {
    PBXNativeTarget: {
      APP: {
        name: "T3Pretty",
        productType: "com.apple.product-type.application",
        buildConfigurationList: "APP_LIST",
      },
      WIDGET: {
        name: "ExpoWidgetsTarget",
        productType: "com.apple.product-type.app-extension",
        buildConfigurationList: "WIDGET_LIST",
      },
    },
    XCConfigurationList: {
      APP_LIST: { buildConfigurations: [{ value: "APP_RELEASE" }] },
      WIDGET_LIST: {
        buildConfigurations: [{ value: "WIDGET_DEBUG" }, { value: "WIDGET_RELEASE" }],
      },
    },
    XCBuildConfiguration: {
      APP_RELEASE: { buildSettings: { CURRENT_PROJECT_VERSION: `"${appBuildNumber}"` } },
      WIDGET_DEBUG: {
        buildSettings: { MARKETING_VERSION: "1.0", CURRENT_PROJECT_VERSION: widgetBuildNumber },
      },
      WIDGET_RELEASE: {
        buildSettings: { MARKETING_VERSION: "1.0", CURRENT_PROJECT_VERSION: widgetBuildNumber },
      },
    },
  };
}

describe("withWidgetLogoAsset version sync", () => {
  it("prefers the EAS-injected ios.buildNumber", () => {
    assert.equal(resolveWidgetBuildNumber({ ios: { buildNumber: 27 } }, widgetProject()), "27");
  });

  it("falls back to the app target CURRENT_PROJECT_VERSION", () => {
    assert.equal(resolveWidgetBuildNumber({}, widgetProject({ appBuildNumber: "12" })), "12");
  });

  it("writes matching marketing and project versions onto the widget target", () => {
    const objects = widgetProject();
    syncWidgetReleaseVersions(objects, {
      targetName: "ExpoWidgetsTarget",
      marketingVersion: "0.0.34",
      buildNumber: "27",
    });

    assert.equal(
      objects.XCBuildConfiguration.WIDGET_DEBUG.buildSettings.MARKETING_VERSION,
      "0.0.34",
    );
    assert.equal(
      objects.XCBuildConfiguration.WIDGET_RELEASE.buildSettings.MARKETING_VERSION,
      "0.0.34",
    );
    assert.equal(
      objects.XCBuildConfiguration.WIDGET_DEBUG.buildSettings.CURRENT_PROJECT_VERSION,
      "27",
    );
    assert.equal(
      objects.XCBuildConfiguration.WIDGET_RELEASE.buildSettings.CURRENT_PROJECT_VERSION,
      "27",
    );
  });
});
