import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

import { publicAndroidSigningInit } from "./build-public-android.mjs";

// Configuration only: no Android compilation, signing, device, or real credentials.
// Point to an installed Gradle wrapper to run against its cached AGP distribution.
it.skipIf(!process.env.T3CODE_TEST_GRADLE_WRAPPER)(
  "configures the approved release key before AGP finalizes the Android DSL",
  () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-public-signing-dsl-"));
    try {
      NodeFS.writeFileSync(
        NodePath.join(root, "settings.gradle"),
        "rootProject.name = 'signing-test'\n",
      );
      NodeFS.writeFileSync(NodePath.join(root, "signing.gradle"), publicAndroidSigningInit);
      NodeFS.writeFileSync(
        NodePath.join(root, "build.gradle"),
        `buildscript {
  repositories { google(); mavenCentral() }
  dependencies { classpath 'com.android.tools.build:gradle:9.2.1' }
}
apply plugin: 'com.android.application'
android {
  namespace = 'test.t3pretty.signing'
  compileSdk = 36
  defaultConfig { minSdk = 24 }
  // Expo's generated release build starts with the debug key. The init must
  // replace this after evaluation of the build file, before DSL finalization.
  buildTypes { release { signingConfig = signingConfigs.getByName('debug') } }
}
tasks.register('verifyPublicSigning') {
  doLast {
    def android = project.extensions.getByName('android')
    def releaseKey = android.buildTypes.getByName('release').signingConfig
    assert releaseKey.name == 't3PublicRelease'
    assert releaseKey.storeFile == new File(System.getenv('T3CODE_PUBLIC_ANDROID_KEYSTORE'))
    assert releaseKey.storePassword == 'fixture-store-password'
    assert releaseKey.keyAlias == 'fixture-public-key'
    assert releaseKey.keyPassword == 'fixture-key-password'
    println 'PUBLIC_SIGNING_DSL_OK'
  }
}
`,
      );
      const result = NodeChildProcess.spawnSync(
        process.env.T3CODE_TEST_GRADLE_WRAPPER,
        [
          "--offline",
          "--no-daemon",
          "--console=plain",
          "-p",
          root,
          "--init-script",
          NodePath.join(root, "signing.gradle"),
          "verifyPublicSigning",
        ],
        {
          encoding: "utf8",
          timeout: 90_000,
          env: {
            ...process.env,
            T3CODE_PUBLIC_ANDROID_KEYSTORE: NodePath.join(root, "fixture-public.jks"),
            T3CODE_PUBLIC_ANDROID_KEY_ALIAS: "fixture-public-key",
            T3CODE_PUBLIC_ANDROID_STORE_PASSWORD: "fixture-store-password",
            T3CODE_PUBLIC_ANDROID_KEY_PASSWORD: "fixture-key-password",
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain("PUBLIC_SIGNING_DSL_OK");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
  100_000,
);
