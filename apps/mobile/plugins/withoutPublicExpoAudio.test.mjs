import * as NodeModule from "node:module";

import { assert, describe, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const {
  excludeExpoAudioFromAndroidSettings,
  excludeExpoAudioFromPodfile,
} = require("./withoutPublicExpoAudio.cjs");

describe("withoutPublicExpoAudio", () => {
  it("excludes expo-audio from the public iOS native graph", () => {
    assert.include(
      excludeExpoAudioFromPodfile("target 'T3Pretty' do\n  use_expo_modules!\nend\n"),
      "use_expo_modules!(exclude: ['expo-audio'])",
    );
  });

  it("excludes expo-audio from the public Android native graph", () => {
    assert.include(
      excludeExpoAudioFromAndroidSettings("expoAutolinking.useExpoModules()\n"),
      'expoAutolinking.exclude = ["expo-audio"]',
    );
  });
});
