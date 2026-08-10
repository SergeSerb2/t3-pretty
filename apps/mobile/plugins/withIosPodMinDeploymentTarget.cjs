const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod } = require("expo/config-plugins");

// Xcode 26+ rejects targets whose IPHONEOS_DEPLOYMENT_TARGET is below 15.0.
// Several pods (ReachabilitySwift, GoogleUtilities privacy bundles, RNSVG
// filter bundles) still declare 12.x, which EAS's older Xcode tolerated but a
// local current-Xcode build does not. Raise only sub-15 targets — pods that
// already ask for more keep their own setting.
const MARKER = "# t3code: raise sub-15 pod deployment targets for current Xcode";
const MIN_TARGET_FIX = `${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        current = config.build_settings["IPHONEOS_DEPLOYMENT_TARGET"].to_f
        if current > 0 && current < 15.0
          config.build_settings["IPHONEOS_DEPLOYMENT_TARGET"] = "15.0"
        end
      end
    end
`;

module.exports = function withIosPodMinDeploymentTarget(config) {
  return withDangerousMod(config, [
    "ios",
    (nextConfig) => {
      const podfilePath = path.join(nextConfig.modRequest.platformProjectRoot, "Podfile");
      const podfile = fs.readFileSync(podfilePath, "utf8");

      if (podfile.includes(MARKER)) {
        return nextConfig;
      }

      const postInstallStart = "post_install do |installer|\n";
      if (!podfile.includes(postInstallStart)) {
        throw new Error("Unable to raise pod deployment targets: post_install is missing.");
      }

      fs.writeFileSync(
        podfilePath,
        podfile.replace(postInstallStart, `${postInstallStart}${MIN_TARGET_FIX}`),
        "utf8",
      );
      return nextConfig;
    },
  ]);
};
