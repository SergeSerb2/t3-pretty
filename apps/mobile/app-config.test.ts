import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { expect, it } from "vite-plus/test";

import { resolveMobileAppIdentity, resolveMobileAppVariant } from "./app-identity.ts";
import config, { resolveRelyingParty, resolveVoiceDictationPlugins } from "./app.config.ts";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

it("resolves public release native config and rejects inherited internal env and OTA settings", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-public-mobile-config-"));
  try {
    const sourceRoot = NodePath.resolve(here, "../..");
    for (const file of [
      "apps/mobile/app.config.ts",
      "apps/mobile/app-identity.ts",
      "scripts/lib/mobile-app-identity.ts",
      "scripts/lib/public-config.ts",
      "scripts/lib/brand-assets.ts",
      ".env.example",
      ".env.internal.example",
    ]) {
      const target = NodePath.join(root, file);
      NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
      NodeFS.copyFileSync(NodePath.join(sourceRoot, file), target);
    }
    NodeFS.writeFileSync(NodePath.join(root, "package.json"), '{"type":"module"}\n');
    const run = (overrides = {}) =>
      NodeChildProcess.spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          "const {default: config} = await import('./apps/mobile/app.config.ts'); console.log(JSON.stringify(config))",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            NODE_ENV: "test",
            PATH: process.env.PATH,
            APP_VARIANT: "production",
            T3CODE_BUILD_FLAVOR: "public",
            T3CODE_PUBLIC_RELEASE: "1",
            EXPO_NO_DOTENV: "1",
            T3CODE_ANDROID_VERSION_CODE: "42",
            ...overrides,
          },
        },
      );
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    const resolved = JSON.parse(result.stdout);
    expect(resolved).toMatchObject({
      name: "T3 Pretty",
      updates: { enabled: false },
      ios: {
        bundleIdentifier: "com.sergeserbinenko.t3pretty.public",
        associatedDomains: ["applinks:clerk.t3.codes", "webcredentials:clerk.t3.codes"],
      },
      android: { package: "com.sergeserbinenko.t3pretty.app", versionCode: 42 },
      extra: {
        buildFlavor: "public",
        clerk: { publishableKey: "pk_live_Y2xlcmsudDMuY29kZXMk", jwtTemplate: "t3-relay" },
        relay: { url: "https://relay.t3.codes" },
      },
    });
    expect(resolved.extra.eas).toBeUndefined();
    for (const file of [".env", ".env.local"]) {
      for (const contents of [
        "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsuc2VyZ2VzZXJiaW5lbmtvLmNvbSQ\n",
        "T3CODE_RELAY_URL=https://relay.sergeserbinenko.com\n",
        "T3CODE_MOBILE_EAS_PROJECT_ID=1eb51d67-48c5-4100-8aa8-f5ac9e1ada65\nT3CODE_MOBILE_UPDATE_URL=https://u.expo.dev/1eb51d67-48c5-4100-8aa8-f5ac9e1ada65\n",
      ]) {
        NodeFS.writeFileSync(NodePath.join(root, file), contents);
        const rejected = run();
        expect(rejected.status).not.toBe(0);
        expect(rejected.stderr).toContain("Public release");
      }
      NodeFS.unlinkSync(NodePath.join(root, file));
    }
    expect(run({ APP_VARIANT: "development" }).status).not.toBe(0);
    expect(
      run({ T3CODE_IOS_PERSONAL_TEAM: "1", T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID: "com.example.test" })
        .status,
    ).not.toBe(0);
    expect(run({ T3CODE_ANDROID_VERSION_CODE: "NaN" }).status).not.toBe(0);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

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

it("keeps ExpoAudio available for public playback without requesting microphone access", () => {
  expect(resolveVoiceDictationPlugins(false)).toEqual([
    [
      "expo-audio",
      { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false },
    ],
  ]);
  const [internalPlugin] = resolveVoiceDictationPlugins(true);
  expect(Array.isArray(internalPlugin) ? internalPlugin[0] : internalPlugin).toBe("expo-audio");
  expect(
    config.plugins?.filter(
      (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-audio",
    ),
  ).toHaveLength(1);
});

it("emits native public playback configuration without microphone permissions", () => {
  const expoCli = NodePath.join(here, "node_modules", "expo", "bin", "cli");
  const raw = NodeChildProcess.execFileSync(
    process.execPath,
    [expoCli, "config", "--type", "introspect", "--json"],
    {
      cwd: here,
      encoding: "utf8",
      env: {
        ...process.env,
        APP_VARIANT: "production",
        T3CODE_BUILD_FLAVOR: "public",
        T3CODE_PUBLIC_RELEASE: "1",
        EXPO_NO_DOTENV: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const resolved = JSON.parse(raw);
  expect(resolved._internal.modResults.ios.infoPlist.NSMicrophoneUsageDescription).toBeUndefined();
  const permissions = resolved._internal.modResults.android.manifest.manifest[
    "uses-permission"
  ] as Array<{ $: Record<string, string> }>;
  expect(
    permissions.some(
      (permission) => permission.$["android:name"] === "android.permission.MODIFY_AUDIO_SETTINGS",
    ),
  ).toBe(true);
  expect(
    permissions.find(
      (permission) => permission.$["android:name"] === "android.permission.RECORD_AUDIO",
    )?.$["tools:node"],
  ).toBe("remove");
});

it("opts iOS out of automatic Liquid Glass until a later IPA re-enables it", () => {
  expect(config.ios?.infoPlist?.UIDesignRequiresCompatibility).toBe(true);
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
