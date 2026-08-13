"use strict";

// Copy the parent app's CFBundleVersion onto the widget's *built* Info.plist.
//
// expo-widgets sets GENERATE_INFOPLIST_FILE=YES and hardcodes
// CURRENT_PROJECT_VERSION=1, so Xcode synthesises CFBundleVersion=1 and ignores
// the source Info.plist. EAS remote autoIncrement writes the real number (28,
// 29, …) onto Info.plist files *after* prebuild via configure_ios_version —
// too late for a config plugin, and it never touches the widget build setting.
// This phase runs during xcodebuild, after "Prepare Info.plist" and before
// signing, and overwrites the generated keys from the parent source plist.

const PHASE_NAME = "Sync Widget Bundle Version";

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

function stripQuotes(value) {
  return String(value ?? "").replace(/^"|"$/g, "");
}

function findApplicationTargetName(objects, widgetTargetName) {
  for (const value of Object.values(objects.PBXNativeTarget || {})) {
    if (!value || typeof value !== "object" || !value.name) continue;
    if (value.name === widgetTargetName) continue;
    if (String(value.productType || "").includes("application")) {
      return stripQuotes(value.name);
    }
  }
  return undefined;
}

function versionSyncScript(appTargetName) {
  return [
    "set -euo pipefail",
    `APP_PLIST="\${SRCROOT}/${appTargetName}/Info.plist"`,
    'DEST="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"',
    'if [ ! -f "$DEST" ]; then',
    '  DEST="${BUILT_PRODUCTS_DIR}/${WRAPPER_NAME}/Info.plist"',
    "fi",
    'if [ ! -f "$DEST" ]; then',
    '  echo "error: widget Info.plist not found for version sync" >&2',
    "  exit 1",
    "fi",
    'if [ ! -f "$APP_PLIST" ]; then',
    '  echo "error: parent Info.plist not found at $APP_PLIST" >&2',
    "  exit 1",
    "fi",
    "for key in CFBundleVersion CFBundleShortVersionString; do",
    '  value="$(/usr/libexec/PlistBuddy -c "Print :${key}" "$APP_PLIST")"',
    '  if [ -z "$value" ]; then',
    '    echo "error: $APP_PLIST is missing $key" >&2',
    "    exit 1",
    "  fi",
    '  case "$value" in',
    "  *[!0-9.]*|'')",
    '    echo "error: $APP_PLIST $key is not a store version: $value" >&2',
    "    exit 1",
    "    ;;",
    "  esac",
    '  /usr/libexec/PlistBuddy -c "Set :${key} ${value}" "$DEST" \\',
    '    || /usr/libexec/PlistBuddy -c "Add :${key} string ${value}" "$DEST"',
    '  echo "Synced widget ${key}=${value} from $APP_PLIST"',
    "done",
  ].join("\n");
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

  const appTargetName = findApplicationTargetName(objects, opts.targetName);
  if (!appTargetName) {
    throw new Error("addWidgetVersionSync: application target not found.");
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
    shellScript: versionSyncScript(appTargetName),
  });
  objects.PBXShellScriptBuildPhase[uuid].alwaysOutOfDate = 1;
  return true;
}

module.exports = {
  PHASE_NAME,
  addWidgetVersionSync,
  findApplicationTargetName,
  versionSyncScript,
};
