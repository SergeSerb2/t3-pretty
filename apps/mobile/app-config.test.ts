import { expect, it } from "vite-plus/test";

import config, {
  resolveProductionAndroidPackage,
  resolveRelyingParty,
  resolveVoiceDictationPlugins,
} from "./app.config.ts";

it("keeps production Android packages valid and side-by-side", () => {
  expect(config.android?.package).toBe("com.sergeserbinenko.t3pretty.app");
  expect(resolveProductionAndroidPackage("internal")).toBe("com.sergeserbinenko.t3pretty");
  expect(resolveProductionAndroidPackage("public")).toBe("com.sergeserbinenko.t3pretty.app");
});

it("keeps relying-party fallbacks within the selected build flavor", () => {
  expect(resolveRelyingParty(undefined, "public")).toBe("clerk.t3.codes");
  expect(resolveRelyingParty("invalid", "public")).toBe("clerk.t3.codes");
  expect(resolveRelyingParty(undefined, "internal")).toBe("clerk.sergeserbinenko.com");
  expect(resolveRelyingParty("pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==", "internal")).toBe(
    "clerk.example.test",
  );
});

it("links expo-audio only for internal mobile builds", () => {
  expect(resolveVoiceDictationPlugins(false)).toEqual(["./plugins/withoutPublicExpoAudio.cjs"]);
  const [internalPlugin] = resolveVoiceDictationPlugins(true);
  expect(Array.isArray(internalPlugin) ? internalPlugin[0] : internalPlugin).toBe("expo-audio");
});
