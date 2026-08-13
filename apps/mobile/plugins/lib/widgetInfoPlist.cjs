"use strict";

// Make the widget extension's built Info.plist come from its source plist.
//
// expo-widgets sets GENERATE_INFOPLIST_FILE=YES, so Xcode synthesises the
// appex plist from build settings and ignores ExpoWidgetsTarget/Info.plist.
// CURRENT_PROJECT_VERSION is hardcoded to 1 at prebuild time, while EAS
// remote autoIncrement resolves the real CFBundleVersion only later — its
// configure step rewrites ios/<target>/Info.plist for every target that has
// a provisioning profile, widget included. The generated plist therefore
// archived the widget at version 1 and App Store validation rejected it
// ("app extension CFBundleVersion 1 must match parent app 28").
//
// The previous workaround copied the app plist's versions onto the built
// appex plist from a shell phase that globbed ${SRCROOT}/*/Info.plist. Under
// the workflow's en_US.UTF-8 locale that glob matches the derived-data
// workspace metadata (build/info.plist — no CFBundleVersion) before the app
// plist, so every archive died with 'Print: Entry, ":CFBundleVersion", Does
// Not Exist'.
//
// The durable fix removes all build-time plist discovery: complete the
// widget's source Info.plist with the keys Xcode was synthesising, then stop
// generating it. The widget then archives with whatever EAS wrote into the
// source plist — the same file, the same values as the app.

const fs = require("fs");
const path = require("path");

// @expo/plist is a declared dependency of @expo/config-plugins; resolve it
// through that package because apps/mobile does not depend on it directly.
function requirePlist() {
  const configPluginsPath = require.resolve("@expo/config-plugins", {
    paths: [require.resolve("expo/package.json")],
  });
  const mod = require(require.resolve("@expo/plist", { paths: [configPluginsPath] }));
  return mod.default ?? mod;
}

// Keys Xcode synthesises while GENERATE_INFOPLIST_FILE=YES. Values mirror the
// standard extension template; variable references resolve from the widget
// target's build settings when Xcode processes the plist.
const SYNTHESIZED_KEYS = {
  CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
  CFBundleExecutable: "$(EXECUTABLE_NAME)",
  CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
  CFBundleInfoDictionaryVersion: "6.0",
  CFBundleName: "$(PRODUCT_NAME)",
  CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
};

/**
 * Add the synthesised keys to the widget's source Info.plist, preserving the
 * keys expo-widgets wrote (NSExtension, ExpoWidgetsAppGroupIdentifier and the
 * prebuild-time versions, which EAS later overwrites for store builds).
 * @param {{ platformProjectRoot: string, targetName: string }} opts
 */
function completeWidgetInfoPlist(opts) {
  const plist = requirePlist();
  const plistPath = path.join(opts.platformProjectRoot, opts.targetName, "Info.plist");
  if (!fs.existsSync(plistPath)) {
    throw new Error(
      `completeWidgetInfoPlist: ${plistPath} not found — ` +
        "withWidgetLogoAsset must be registered before expo-widgets so its " +
        "dangerous mod runs after the widget files are generated.",
    );
  }
  const parsed = plist.parse(fs.readFileSync(plistPath, "utf8"));
  for (const [key, value] of Object.entries(SYNTHESIZED_KEYS)) {
    parsed[key] ??= value;
  }
  parsed.CFBundleDisplayName ??= opts.targetName;
  fs.writeFileSync(plistPath, plist.build(parsed));
}

function stripComments(map) {
  const out = {};
  for (const key of Object.keys(map || {})) {
    if (key.endsWith("_comment")) continue;
    out[key] = map[key];
  }
  return out;
}

function findByName(map, name) {
  for (const [uuid, value] of Object.entries(stripComments(map))) {
    if (value && value.name === name) return { uuid, value };
  }
  return null;
}

/**
 * Point the widget target at its source Info.plist instead of a generated
 * one. expo-widgets quotes the setting ("YES"); keep the quoted form so the
 * pbxproj diff stays a one-word change.
 * @param {import('xcode').XcodeProject} proj
 * @param {{ targetName: string }} opts
 */
function useSourceInfoPlistFile(proj, opts) {
  const objects = proj.hash.project.objects;
  const target = findByName(objects.PBXNativeTarget, opts.targetName);
  if (!target) {
    throw new Error(
      `useSourceInfoPlistFile: target "${opts.targetName}" not found — ` +
        "withWidgetLogoAsset must be registered before expo-widgets so its " +
        "xcodeproj mod runs after the widget target is created.",
    );
  }

  const configurationList = objects.XCConfigurationList?.[target.value.buildConfigurationList];
  if (!configurationList) {
    throw new Error(
      `useSourceInfoPlistFile: build configurations for "${opts.targetName}" not found.`,
    );
  }
  for (const reference of configurationList.buildConfigurations || []) {
    const buildConfiguration = objects.XCBuildConfiguration?.[reference.value];
    if (!buildConfiguration?.buildSettings) continue;
    buildConfiguration.buildSettings.GENERATE_INFOPLIST_FILE = '"NO"';
  }
}

module.exports = { completeWidgetInfoPlist, useSourceInfoPlistFile };
