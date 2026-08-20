"use strict";

// Ships the branded T3 mark to the Live Activity / widget extension, and
// makes the extension archive with the app's store versions.
//
// expo-widgets generates ExpoWidgetsTarget without a Resources build phase and
// has no asset support, so this plugin (a) writes a template image set into
// the generated widget asset catalog and (b) wires that catalog into the widget
// target with an actool build phase.
//
// Versioning: expo-widgets sets GENERATE_INFOPLIST_FILE=YES and hardcodes
// CURRENT_PROJECT_VERSION=1, so Xcode synthesised the appex Info.plist at
// CFBundleVersion=1 while EAS remote autoIncrement stamped the real number
// into the app — App Store validation rejects that mismatch. EAS's configure
// step rewrites ios/<target>/Info.plist (widget included) with the resolved
// versions before fastlane runs, so this plugin completes the widget's source
// Info.plist with the keys Xcode was synthesising and flips
// GENERATE_INFOPLIST_FILE off. The built appex then carries exactly what EAS
// wrote — no build-phase plist copying. (The previous "Sync Widget Bundle
// Version" phase globbed ios/*\/Info.plist at archive time; under the CI
// locale that matched the derived-data build/info.plist first and failed
// every archive with 'Print: Entry, ":CFBundleVersion", Does Not Exist'.)
//
// ORDERING: must be listed BEFORE "expo-widgets" in the plugins array. Expo
// chains same-type mods so the last-registered runs FIRST; registering this
// plugin earlier makes its mods run AFTER expo-widgets' mods. That matters
// twice: expo-widgets' dangerous mod rmSync's ios/ExpoWidgetsTarget/ (deleting
// any catalog written before it), and its xcodeproj mod is what creates the
// widget target. Listed after expo-widgets, both steps silently no-op on a
// fresh prebuild — which is how prod build 8 shipped without the logo.

const path = require("path");
const fs = require("fs");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");
const { addWidgetAssetCatalog } = require("./lib/addWidgetAssetCatalog.cjs");
const { completeWidgetInfoPlist, useSourceInfoPlistFile } = require("./lib/widgetInfoPlist.cjs");

const TARGET_NAME = "ExpoWidgetsTarget";
const CATALOG_NAME = "Assets.xcassets";
const IMAGE_SET = "T3Mark.imageset";
// Committed next to this plugin at assets/widget/T3Mark.png — a copy of the
// brand kit's black template glyph (assets/pretty/kit/mark-black.png, 480×351).
// AgentActivity tints it via foregroundStyle, so the imageset must stay a
// template — a full-color or vector-wrapped raster asset would not recolor.
const PNG_NAME = "T3Mark.png";

const CATALOG_CONTENTS = JSON.stringify({ info: { author: "expo", version: 1 } }, null, 2) + "\n";
const IMAGE_SET_CONTENTS =
  JSON.stringify(
    {
      images: [{ idiom: "universal", filename: PNG_NAME }],
      info: { author: "expo", version: 1 },
      properties: {
        "template-rendering-intent": "template",
      },
    },
    null,
    2,
  ) + "\n";

function withAssetFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const source = path.join(cfg.modRequest.projectRoot, "assets", "widget", PNG_NAME);
      const catalogDir = path.join(cfg.modRequest.platformProjectRoot, TARGET_NAME, CATALOG_NAME);
      const imageSetDir = path.join(catalogDir, IMAGE_SET);
      fs.mkdirSync(imageSetDir, { recursive: true });
      fs.writeFileSync(path.join(catalogDir, "Contents.json"), CATALOG_CONTENTS);
      fs.writeFileSync(path.join(imageSetDir, "Contents.json"), IMAGE_SET_CONTENTS);
      fs.copyFileSync(source, path.join(imageSetDir, PNG_NAME));
      completeWidgetInfoPlist({
        platformProjectRoot: cfg.modRequest.platformProjectRoot,
        targetName: TARGET_NAME,
      });
      return cfg;
    },
  ]);
}

function withAssetWiring(config) {
  return withXcodeProject(config, (cfg) => {
    addWidgetAssetCatalog(cfg.modResults, { targetName: TARGET_NAME });
    useSourceInfoPlistFile(cfg.modResults, { targetName: TARGET_NAME });
    return cfg;
  });
}

module.exports = function withWidgetLogoAsset(config) {
  return withAssetWiring(withAssetFiles(config));
};
