import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

import { buildPublicAndroid } from "./build-public-android.mjs";

it("builds both native release formats locally with a fixed public version and explicit signing", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-public-android-test-"));
  try {
    const mobile = NodePath.join(root, "apps/mobile");
    const bin = NodePath.join(root, "bin");
    NodeFS.mkdirSync(mobile, { recursive: true });
    NodeFS.mkdirSync(bin);
    const keystore = NodePath.join(root, "approved-public-key.jks");
    NodeFS.writeFileSync(keystore, "fixture");
    NodeFS.writeFileSync(
      NodePath.join(bin, "vp"),
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.includes('config')) {
  console.log(JSON.stringify({
    android: {package: 'com.sergeserbinenko.t3pretty.app', versionCode: Number(process.env.T3CODE_ANDROID_VERSION_CODE)},
    version: process.env.T3CODE_MOBILE_APP_VERSION,
    updates: {enabled: false},
    extra: {buildFlavor: process.env.T3CODE_BUILD_FLAVOR, relay: {url:'https://relay.t3.codes'}, clerk: {publishableKey:'pk_live_Y2xlcmsudDMuY29kZXMk', jwtTemplate:'t3-relay'}}
  }));
} else if (process.argv.includes('prebuild')) {
  fs.mkdirSync('android');
  fs.copyFileSync(process.env.TEST_GRADLE_SOURCE, 'android/gradlew');
} else process.exit(77);
`,
      { mode: 0o755 },
    );
    const gradle = NodePath.join(bin, "gradle-fixture");
    const record = NodePath.join(root, "gradle-call.json");
    NodeFS.writeFileSync(
      gradle,
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const init = process.argv[process.argv.indexOf('--init-script')+1];
fs.writeFileSync(process.env.TEST_GRADLE_RECORD, JSON.stringify({args: process.argv.slice(2), initExists:fs.existsSync(init), keystore:process.env.T3CODE_PUBLIC_ANDROID_KEYSTORE, version:process.env.T3CODE_MOBILE_APP_VERSION, versionCode:process.env.T3CODE_ANDROID_VERSION_CODE, ota:process.env.T3CODE_MOBILE_UPDATES_ENABLED, release:process.env.T3CODE_PUBLIC_RELEASE}));
for(const file of ['app/build/outputs/apk/release/app-release.apk','app/build/outputs/bundle/release/app-release.aab']) {
  fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file,'signed-fixture');
}
`,
      { mode: 0o755 },
    );
    const baseEnv = {
      PATH: `${bin}:${process.env.PATH}`,
      TEST_GRADLE_SOURCE: gradle,
      TEST_GRADLE_RECORD: record,
      T3CODE_PUBLIC_ANDROID_KEYSTORE: keystore,
      T3CODE_PUBLIC_ANDROID_KEY_ALIAS: "public",
      T3CODE_PUBLIC_ANDROID_STORE_PASSWORD: "fixture-password",
      T3CODE_PUBLIC_ANDROID_KEY_PASSWORD: "fixture-password",
    };
    const input = {
      root,
      baseEnv,
      version: "1.2.3",
      versionCode: "42",
      outDir: NodePath.join(root, "out"),
    };
    expect(() =>
      buildPublicAndroid({
        ...input,
        baseEnv: { ...baseEnv, T3CODE_PUBLIC_ANDROID_KEY_ALIAS: "" },
      }),
    ).toThrow(/KEY_ALIAS/u);
    expect(() => buildPublicAndroid({ ...input, versionCode: "42.5" })).toThrow(/version-code/u);
    const credentialsFile = NodePath.join(root, "credentials.json");
    NodeFS.writeFileSync(
      credentialsFile,
      JSON.stringify({
        keystorePath: NodePath.basename(keystore),
        keystorePassword: "fixture-password",
        keyAlias: "public",
        keyPassword: "fixture-password",
      }),
    );
    buildPublicAndroid({
      ...input,
      credentialsFile,
      baseEnv: {
        PATH: baseEnv.PATH,
        TEST_GRADLE_SOURCE: gradle,
        TEST_GRADLE_RECORD: record,
      },
    });
    const call = JSON.parse(NodeFS.readFileSync(record, "utf8"));
    expect(call).toMatchObject({
      initExists: true,
      keystore,
      version: "1.2.3",
      versionCode: "42",
      ota: "0",
      release: "1",
    });
    expect(call.args).toContain(":app:assembleRelease");
    expect(call.args).toContain(":app:bundleRelease");
    expect(NodeFS.existsSync(call.args[call.args.indexOf("--init-script") + 1])).toBe(false);
    for (const extension of ["apk", "aab"]) {
      expect(
        NodeFS.readFileSync(NodePath.join(input.outDir, `t3-pretty-1.2.3.${extension}`), "utf8"),
      ).toBe("signed-fixture");
    }
    expect(() => buildPublicAndroid(input)).toThrow(/disposable checkout/u);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("keeps public EAS profiles separate from internal production and store submission", () => {
  const eas = JSON.parse(
    NodeFS.readFileSync(new URL("../../apps/mobile/eas.json", import.meta.url), "utf8"),
  );
  expect(eas.build["public-apk"].android.buildType).toBe("apk");
  expect(eas.build["public-apk"].credentialsSource).toBe("local");
  expect(eas.build["public-apk"].autoIncrement).toBe(false);
  expect(eas.build["public-apk"].env).toMatchObject({
    APP_VARIANT: "production",
    T3CODE_BUILD_FLAVOR: "public",
    T3CODE_PUBLIC_RELEASE: "1",
    T3CODE_MOBILE_UPDATES_ENABLED: "0",
  });
  expect(eas.build["public-aab"].extends).toBe("public-apk");
  expect(eas.build["public-aab"].android.buildType).toBe("app-bundle");
  expect(eas.submit["public-apk"]).toBeUndefined();
  expect(eas.submit["public-aab"]).toBeUndefined();
});
