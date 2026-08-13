"use strict";

// Copy the parent app's CFBundleVersion onto the widget's *built* Info.plist.
//
// expo-widgets sets GENERATE_INFOPLIST_FILE=YES and hardcodes
// CURRENT_PROJECT_VERSION=1, so Xcode synthesises CFBundleVersion=1 and ignores
// the source Info.plist. EAS remote autoIncrement writes the real number onto
// Info.plist files *after* prebuild via configure_ios_version — too late for a
// config plugin, and it never touches the widget build setting.
//
// The real script lives on disk (sync-widget-bundle-version.sh). The pbxproj
// phase is only a one-line bash call: a previous inline multiline script with
// nested quotes produced a raw newline inside a quoted pbxproj string, and
// CocoaPods/Nanaimo refused to parse the project.

const PHASE_NAME = "Sync Widget Bundle Version";
const SCRIPT_NAME = "sync-widget-bundle-version.sh";

const PHASE_SCRIPT = ["set -e", `bash "\${SRCROOT}/ExpoWidgetsTarget/${SCRIPT_NAME}"`].join("\n");

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
 * @param {import('xcode').XcodeProject} proj
 * @param {{ targetName: string }} opts
 */
function addWidgetVersionSync(proj, opts) {
  const objects = proj.hash.project.objects;
  const target = findByName(objects.PBXNativeTarget, opts.targetName);
  if (!target) {
    throw new Error(
      `addWidgetVersionSync: target "${opts.targetName}" not found — ` +
        "withWidgetLogoAsset must be registered before expo-widgets so its " +
        "xcodeproj mod runs after the widget target is created.",
    );
  }

  const phases = target.value.buildPhases || [];
  const existing = objects.PBXShellScriptBuildPhase || {};
  const already = Object.entries(stripComments(existing)).some(
    ([uuid, value]) =>
      value && value.name === `"${PHASE_NAME}"` && phases.some((p) => p.value === uuid),
  );
  if (already) return false;

  const { uuid } = proj.addBuildPhase([], "PBXShellScriptBuildPhase", PHASE_NAME, target.uuid, {
    shellPath: "/bin/sh",
    shellScript: PHASE_SCRIPT,
  });
  objects.PBXShellScriptBuildPhase[uuid].alwaysOutOfDate = 1;
  return true;
}

module.exports = {
  PHASE_NAME,
  PHASE_SCRIPT,
  SCRIPT_NAME,
  addWidgetVersionSync,
};
