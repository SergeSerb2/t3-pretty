import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { expect, it } from "vite-plus/test";

import { resolveMobileAppIdentity, resolveMobileAppVariant } from "./app-identity.ts";
import config, { resolveRelyingParty, resolveVoiceDictationPlugins } from "./app.config.ts";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

it("matches the default Expo config to its selected build identity", () => {
  const buildFlavor = config.extra?.buildFlavor;
  if (buildFlavor !== "internal" && buildFlavor !== "public") {
    throw new Error("Expo config must expose its selected build flavor.");
  }
  const identity = resolveMobileAppIdentity(
    resolveMobileAppVariant(config.extra?.appVariant),
    buildFlavor,
  );
  expect(config.scheme).toBe(identity.scheme);
  expect(config.android?.package).toBe(identity.androidPackage);
});

it("resolves every mobile variant from the selected build identity", () => {
  expect(resolveMobileAppIdentity("development", "internal")).toEqual({
    scheme: "t3code-dev",
    iosBundleIdentifier: "com.sergeserbinenko.t3pretty.dev",
    androidPackage: "com.sergeserbinenko.t3pretty.dev",
  });
  expect(resolveMobileAppIdentity("preview", "public")).toEqual({
    scheme: "t3code-preview",
    iosBundleIdentifier: "com.sergeserbinenko.t3pretty.preview",
    androidPackage: "com.sergeserbinenko.t3pretty.preview",
  });
  expect(resolveMobileAppIdentity("production", "internal")).toEqual({
    scheme: "t3code",
    iosBundleIdentifier: "com.sergeserbinenko.t3pretty",
    androidPackage: "com.sergeserbinenko.t3pretty",
  });
  expect(resolveMobileAppIdentity("production", "public")).toEqual({
    scheme: "t3code",
    iosBundleIdentifier: "com.sergeserbinenko.t3pretty.public",
    androidPackage: "com.sergeserbinenko.t3pretty.app",
  });
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

it("emits the release fingerprint override as a literal runtime version", () => {
  const expectedFingerprint = "a21dfbf91ea34506691ef12e24f26e9ddb36b901";
  const expoCli = NodePath.join(here, "node_modules", "expo", "bin", "cli");
  const rawConfig = NodeChildProcess.execFileSync(process.execPath, [expoCli, "config", "--json"], {
    cwd: here,
    encoding: "utf8",
    env: {
      ...process.env,
      APP_VARIANT: "production",
      EXPO_NO_DOTENV: "1",
      EXPO_UPDATES_FINGERPRINT_OVERRIDE: expectedFingerprint,
      T3CODE_BUILD_FLAVOR: "internal",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  expect(JSON.parse(rawConfig).runtimeVersion).toBe(expectedFingerprint);
});
