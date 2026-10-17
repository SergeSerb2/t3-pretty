import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const [repoRoot, mode] = process.argv.slice(2);
const mobileRequire = NodeModule.createRequire(NodePath.join(repoRoot, "apps/mobile/package.json"));
const expoRequire = NodeModule.createRequire(mobileRequire.resolve("expo/fingerprint"));
const { installModuleCaptureHook } = expoRequire("@expo/fingerprint/build/ExpoConfigLoader.js");

if (mode === "typescript") {
  const scratch = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-native-fingerprint-"));
  try {
    await NodeFSP.writeFile(NodePath.join(scratch, "package.json"), '{"type":"module"}');
    await NodeFSP.writeFile(
      NodePath.join(scratch, "dependency.ts"),
      'export const name = "T3PrettyDev" as string;\n',
    );
    const entry = NodePath.join(await NodeFSP.realpath(scratch), "config.ts");
    await NodeFSP.writeFile(
      entry,
      'import { name } from "./dependency.ts";\nexport const config = { name } satisfies { name: string };\n',
    );
    const capture = installModuleCaptureHook();
    try {
      const require = NodeModule.createRequire(NodePath.join(scratch, "package.json"));
      NodeAssert.equal(require(entry).config.name, "T3PrettyDev");
      const captured = capture.getCapturedModules();
      NodeAssert.ok(captured.some((source) => source.filename === entry));
    } finally {
      capture.uninstall();
    }
    process.stdout.write("native TypeScript imports captured\n");
  } finally {
    await NodeFSP.rm(scratch, { recursive: true, force: true });
  }
} else if (mode === "forwarding") {
  const originalCompile = NodeModule.default.prototype._compile;
  const receiver = new NodeModule.default("t3-config-forwarding");
  const result = { compiled: true };
  const args = ["const value = 1", "config.ts", "module-typescript", { future: true }];
  NodeModule.default.prototype._compile = function (...actualArgs) {
    NodeAssert.equal(this, receiver);
    NodeAssert.deepEqual(actualArgs, args);
    return result;
  };
  try {
    const capture = installModuleCaptureHook();
    try {
      NodeAssert.equal(receiver._compile(...args), result);
      NodeAssert.deepEqual(capture.getCapturedModules(), [
        { id: receiver.id, filename: args[1], content: args[0] },
      ]);
    } finally {
      capture.uninstall();
    }
    process.stdout.write("compiler contract preserved\n");
  } finally {
    NodeModule.default.prototype._compile = originalCompile;
  }
} else if (mode === "configuration") {
  Object.assign(process.env, {
    APP_VARIANT: "development",
    MOBILE_VERSION_POLICY: "appVersion",
    T3CODE_IOS_PERSONAL_TEAM: "0",
    T3CODE_MOBILE_APP_VERSION: "12.3.4",
  });
  const { loadConfigAsync } = expoRequire("@expo/fingerprint/build/Config.js");
  const config = await loadConfigAsync(NodePath.join(repoRoot, "apps/mobile"), true);
  const { exp } = mobileRequire("expo/config").getConfig(NodePath.join(repoRoot, "apps/mobile"), {
    skipPlugins: true,
  });
  NodeAssert.equal(config.nativeModuleSourceType, "files");
  NodeAssert.equal(
    config.extraSources.find((source) => source.id === "appMajorVersion").contents,
    exp.version.split(".")[0],
  );
  NodeAssert.equal(exp.version, "12.3.4");
  process.stdout.write("native fingerprint configuration loaded\n");
} else if (mode === "native-sources") {
  Object.assign(process.env, {
    APP_VARIANT: "development",
    MOBILE_VERSION_POLICY: "appVersion",
    T3CODE_IOS_PERSONAL_TEAM: "0",
    EXPO_NO_DOTENV: "1",
  });
  const scratch = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-native-sources-"));
  try {
    const mobileRoot = NodePath.join(repoRoot, "apps/mobile");
    await NodeFSP.symlink(
      NodePath.join(mobileRoot, "node_modules"),
      NodePath.join(scratch, "node_modules"),
      "junction",
    );
    for (const name of ["fingerprint.config.js", ".fingerprintignore"]) {
      await NodeFSP.copyFile(NodePath.join(mobileRoot, name), NodePath.join(scratch, name));
    }
    await NodeFSP.writeFile(
      NodePath.join(scratch, "package.json"),
      JSON.stringify({
        name: "t3-native-fingerprint-fixture",
        version: "1.0.0",
        dependencies: {
          expo: mobileRequire("expo/package.json").version,
          "expo-widgets": mobileRequire("expo-widgets/package.json").version,
        },
      }),
    );
    await NodeFSP.writeFile(
      NodePath.join(scratch, "app.json"),
      JSON.stringify({
        expo: {
          name: "Native fingerprint fixture",
          slug: "native-fingerprint-fixture",
          version: "1.0.0",
        },
      }),
    );
    const moduleRoot = NodePath.join(scratch, "modules/native-fixture");
    await NodeFSP.mkdir(NodePath.join(moduleRoot, "android/src/main"), { recursive: true });
    await NodeFSP.mkdir(NodePath.join(moduleRoot, "ios"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(moduleRoot, "package.json"),
      JSON.stringify({ name: "t3-native-fixture", version: "1.0.0" }),
    );
    await NodeFSP.writeFile(
      NodePath.join(moduleRoot, "expo-module.config.json"),
      JSON.stringify({
        platforms: ["apple", "android"],
        android: { modules: ["expo.modules.fixture.NativeFixtureModule"] },
        apple: { modules: ["NativeFixtureModule"] },
      }),
    );
    await NodeFSP.writeFile(
      NodePath.join(moduleRoot, "android/build.gradle"),
      "apply plugin: 'com.android.library'\n",
    );
    await NodeFSP.writeFile(
      NodePath.join(moduleRoot, "NativeFixture.podspec"),
      "Pod::Spec.new do |s|\n  s.name = 'NativeFixture'\n  s.version = '1.0.0'\nend\n",
    );
    const androidSource = NodePath.join(moduleRoot, "android/src/main/NativeFixture.kt");
    const iosSource = NodePath.join(moduleRoot, "ios/NativeFixture.swift");
    await NodeFSP.writeFile(androidSource, "class NativeFixtureModule {}\n");
    await NodeFSP.writeFile(iosSource, "final class NativeFixtureModule {}\n");
    const { createFingerprintAsync } = mobileRequire("expo/fingerprint");
    const fingerprint = (platform) =>
      createFingerprintAsync(scratch, { platforms: [platform], silent: true });
    const androidBefore = await fingerprint("android");
    const androidConfig = androidBefore.sources.find(
      (source) => source.id === "expoAutolinkingConfig:android",
    );
    NodeAssert.ok(
      androidConfig,
      "External Maven plugins must not discard the Expo autolinking sources",
    );
    NodeAssert.ok(
      JSON.parse(androidConfig.contents).modules.some((module) =>
        module.plugins?.some(
          (plugin) =>
            plugin.id === "io.github.expo.peek.glance-fork" && plugin.version && !plugin.sourceDir,
        ),
      ),
      "Keep the external Gradle plugin metadata in the fingerprint",
    );
    NodeAssert.ok(
      androidBefore.sources.some(
        (source) => source.filePath === "modules/native-fixture/android" && source.hash,
      ),
      "Hash local Android modules",
    );
    const iosBefore = await fingerprint("ios");
    NodeAssert.ok(
      iosBefore.sources.some(
        (source) => source.filePath === "modules/native-fixture" && source.hash,
      ),
      "Hash local iOS modules",
    );
    await NodeFSP.appendFile(androidSource, "// Native Android change\n");
    const androidAfter = await fingerprint("android");
    NodeAssert.notEqual(
      androidAfter.hash,
      androidBefore.hash,
      "A native Android edit must change its runtime fingerprint",
    );
    NodeAssert.equal(
      (await fingerprint("ios")).hash,
      iosBefore.hash,
      "Android-only native edits must not change the iOS runtime fingerprint",
    );
    for (const relative of [
      "android/build/generated/output.txt",
      "android/.gradle/cache.txt",
      "ios/build/output.txt",
      "ios/Pods/generated.txt",
    ]) {
      const output = NodePath.join(moduleRoot, relative);
      await NodeFSP.mkdir(NodePath.dirname(output), { recursive: true });
      await NodeFSP.writeFile(output, "generated build output\n");
    }
    NodeAssert.equal(
      (await fingerprint("android")).hash,
      androidAfter.hash,
      "Generated native output must not change Android compatibility",
    );
    NodeAssert.equal(
      (await fingerprint("ios")).hash,
      iosBefore.hash,
      "Generated native output must not change iOS compatibility",
    );
    await NodeFSP.appendFile(iosSource, "// Native iOS change\n");
    NodeAssert.notEqual(
      (await fingerprint("ios")).hash,
      iosBefore.hash,
      "A native iOS edit must change its runtime fingerprint",
    );
    NodeAssert.equal(
      (await fingerprint("android")).hash,
      androidAfter.hash,
      "iOS-only native edits must not change the Android runtime fingerprint",
    );
    process.stdout.write("native sources and platform boundaries preserved\n");
  } finally {
    await NodeFSP.rm(scratch, { recursive: true, force: true });
  }
} else {
  throw new Error(`Unknown probe mode: ${mode}`);
}
