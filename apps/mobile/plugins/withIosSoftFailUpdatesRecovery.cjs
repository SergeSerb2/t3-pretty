const fs = require("node:fs");
const path = require("node:path");

const MARKER = "// t3code: soft-fail updates error recovery";
const CRASH_SIGNATURE = "private func crash() {";

/**
 * Expo Updates ErrorRecovery's last pipeline task re-raises the captured
 * JS/RN fatal (`throwException`). Tip TestFlight builds 159/162/163 abort
 * on that path after the remote load comes back without a newer bundle.
 * Returning here keeps the process alive so the embedded/cached UI can
 * stay open; the fatal is already written to the updates log.
 */
function softFailUpdatesErrorRecovery(contents) {
  if (contents.includes(MARKER)) return contents;
  const index = contents.indexOf(CRASH_SIGNATURE);
  if (index === -1) {
    throw new Error(
      "Could not patch expo-updates ErrorRecovery.crash(); Expo source changed.",
    );
  }
  const insert = `
    ${MARKER}
    return
`;
  return (
    contents.slice(0, index + CRASH_SIGNATURE.length) +
    insert +
    contents.slice(index + CRASH_SIGNATURE.length)
  );
}

function resolveErrorRecoveryPath(projectRoot) {
  const packageJson = require.resolve("expo-updates/package.json", { paths: [projectRoot] });
  return path.join(path.dirname(packageJson), "ios/EXUpdates/ErrorRecovery.swift");
}

module.exports = function withIosSoftFailUpdatesRecovery(config) {
  const { withDangerousMod } = require("expo/config-plugins");
  return withDangerousMod(config, [
    "ios",
    (nextConfig) => {
      const filePath = resolveErrorRecoveryPath(nextConfig.modRequest.projectRoot);
      fs.writeFileSync(
        filePath,
        softFailUpdatesErrorRecovery(fs.readFileSync(filePath, "utf8")),
        "utf8",
      );
      return nextConfig;
    },
  ]);
};

module.exports.softFailUpdatesErrorRecovery = softFailUpdatesErrorRecovery;
module.exports.CRASH_SIGNATURE = CRASH_SIGNATURE;
module.exports.MARKER = MARKER;
