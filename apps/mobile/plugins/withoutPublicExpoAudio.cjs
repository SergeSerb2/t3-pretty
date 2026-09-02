const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod } = require("expo/config-plugins");

const IOS_MARKER = "# t3code: exclude internal-only expo-audio";
const ANDROID_MARKER = "// t3code: exclude internal-only expo-audio";

function excludeExpoAudioFromPodfile(contents) {
  if (contents.includes(IOS_MARKER)) return contents;
  const pattern = /^(\s*)use_expo_modules!\s*$/m;
  if (!pattern.test(contents))
    throw new Error("Unable to exclude expo-audio: use_expo_modules! is missing.");
  return contents.replace(pattern, `$1use_expo_modules!(exclude: ['expo-audio']) ${IOS_MARKER}`);
}

function excludeExpoAudioFromAndroidSettings(contents) {
  if (contents.includes(ANDROID_MARKER)) return contents;
  const pattern = /^(\s*)expoAutolinking\.useExpoModules\(\)\s*$/m;
  if (!pattern.test(contents)) {
    throw new Error("Unable to exclude expo-audio: expoAutolinking.useExpoModules() is missing.");
  }
  return contents.replace(
    pattern,
    `$1expoAutolinking.exclude = ["expo-audio"] ${ANDROID_MARKER}\n$&`,
  );
}

module.exports = function withoutPublicExpoAudio(config) {
  config = withDangerousMod(config, [
    "ios",
    (nextConfig) => {
      const podfilePath = path.join(nextConfig.modRequest.platformProjectRoot, "Podfile");
      fs.writeFileSync(
        podfilePath,
        excludeExpoAudioFromPodfile(fs.readFileSync(podfilePath, "utf8")),
        "utf8",
      );
      return nextConfig;
    },
  ]);
  return withDangerousMod(config, [
    "android",
    (nextConfig) => {
      const settingsPath = path.join(nextConfig.modRequest.platformProjectRoot, "settings.gradle");
      fs.writeFileSync(
        settingsPath,
        excludeExpoAudioFromAndroidSettings(fs.readFileSync(settingsPath, "utf8")),
        "utf8",
      );
      return nextConfig;
    },
  ]);
};

module.exports.excludeExpoAudioFromPodfile = excludeExpoAudioFromPodfile;
module.exports.excludeExpoAudioFromAndroidSettings = excludeExpoAudioFromAndroidSettings;
