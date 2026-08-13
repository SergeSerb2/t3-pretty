import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const { completeWidgetInfoPlist, useSourceInfoPlistFile } = require("./widgetInfoPlist.cjs");

const EXPO_WIDGETS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>NSExtension</key>
    <dict>
      <key>NSExtensionPointIdentifier</key>
      <string>com.apple.widgetkit-extension</string>
    </dict>
    <key>ExpoWidgetsAppGroupIdentifier</key>
    <string>group.com.example.app</string>
    <key>CFBundleShortVersionString</key>
    <string>0.0.34</string>
    <key>CFBundleVersion</key>
    <string>1</string>
  </dict>
</plist>
`;

function writeWidgetDir(plistContents = EXPO_WIDGETS_PLIST) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "widget-info-plist-"));
  const targetDir = NodePath.join(root, "ExpoWidgetsTarget");
  NodeFS.mkdirSync(targetDir);
  NodeFS.writeFileSync(NodePath.join(targetDir, "Info.plist"), plistContents);
  return root;
}

function widgetProject({ generate = '"YES"' } = {}) {
  return {
    objects: {
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
        APP_RELEASE: { buildSettings: { GENERATE_INFOPLIST_FILE: undefined } },
        WIDGET_DEBUG: { buildSettings: { GENERATE_INFOPLIST_FILE: generate } },
        WIDGET_RELEASE: { buildSettings: { GENERATE_INFOPLIST_FILE: generate } },
      },
    },
  };
}

describe("completeWidgetInfoPlist", () => {
  it("adds the keys Xcode was synthesising and keeps the expo-widgets keys", () => {
    const root = writeWidgetDir();
    completeWidgetInfoPlist({ platformProjectRoot: root, targetName: "ExpoWidgetsTarget" });
    const written = NodeFS.readFileSync(
      NodePath.join(root, "ExpoWidgetsTarget", "Info.plist"),
      "utf8",
    );

    // The extension identity expo-widgets wrote survives untouched.
    assert.include(written, "com.apple.widgetkit-extension");
    assert.include(written, "group.com.example.app");
    assert.include(written, "<string>0.0.34</string>");

    // The synthesized keys must be present or App Store validation rejects the
    // appex; they resolve from build settings when Xcode processes the plist.
    for (const key of [
      "CFBundleExecutable",
      "CFBundleIdentifier",
      "CFBundleInfoDictionaryVersion",
      "CFBundleName",
      "CFBundlePackageType",
      "CFBundleDevelopmentRegion",
      "CFBundleDisplayName",
    ]) {
      assert.include(written, `<key>${key}</key>`);
    }
    assert.include(written, "<string>$(EXECUTABLE_NAME)</string>");
    assert.include(written, "<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>");
  });

  it("never overwrites a CFBundleVersion EAS already stamped in", () => {
    const root = writeWidgetDir();
    completeWidgetInfoPlist({ platformProjectRoot: root, targetName: "ExpoWidgetsTarget" });
    const written = NodeFS.readFileSync(
      NodePath.join(root, "ExpoWidgetsTarget", "Info.plist"),
      "utf8",
    );
    assert.include(written, "<key>CFBundleVersion</key>\n    <string>1</string>");
  });

  it("throws when the widget files are missing (plugin ordering bug)", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "widget-info-plist-"));
    assert.throws(
      () => completeWidgetInfoPlist({ platformProjectRoot: root, targetName: "ExpoWidgetsTarget" }),
      /not found/,
    );
  });
});

describe("useSourceInfoPlistFile", () => {
  it("stops Xcode from generating the widget plist on every configuration", () => {
    const { objects } = widgetProject();
    useSourceInfoPlistFile({ hash: { project: { objects } } }, { targetName: "ExpoWidgetsTarget" });

    assert.equal(
      objects.XCBuildConfiguration.WIDGET_DEBUG.buildSettings.GENERATE_INFOPLIST_FILE,
      '"NO"',
    );
    assert.equal(
      objects.XCBuildConfiguration.WIDGET_RELEASE.buildSettings.GENERATE_INFOPLIST_FILE,
      '"NO"',
    );
    // The app target is not touched.
    assert.equal(
      objects.XCBuildConfiguration.APP_RELEASE.buildSettings.GENERATE_INFOPLIST_FILE,
      undefined,
    );
  });

  it("throws when the widget target does not exist yet", () => {
    const { objects } = widgetProject();
    assert.throws(
      () => useSourceInfoPlistFile({ hash: { project: { objects } } }, { targetName: "Missing" }),
      /not found/,
    );
  });
});
