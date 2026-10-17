#!/usr/bin/env node
// Local native build only. No EAS account, remote version counter, OTA, or submission.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const repoRoot = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const signingNames = [
  "T3CODE_PUBLIC_ANDROID_KEYSTORE",
  "T3CODE_PUBLIC_ANDROID_KEY_ALIAS",
  "T3CODE_PUBLIC_ANDROID_STORE_PASSWORD",
  "T3CODE_PUBLIC_ANDROID_KEY_PASSWORD",
];

export const publicAndroidSigningInit = `allprojects { project ->
  project.plugins.withId('com.android.application') {
    // AGP 9 finalizes signing configs before afterEvaluate callbacks run.
    project.extensions.getByName('androidComponents').finalizeDsl { android ->
      def releaseKey = android.signingConfigs.create('t3PublicRelease') {
        storeFile = new File(System.getenv('T3CODE_PUBLIC_ANDROID_KEYSTORE'))
        storePassword = System.getenv('T3CODE_PUBLIC_ANDROID_STORE_PASSWORD')
        keyAlias = System.getenv('T3CODE_PUBLIC_ANDROID_KEY_ALIAS')
        keyPassword = System.getenv('T3CODE_PUBLIC_ANDROID_KEY_PASSWORD')
      }
      android.buildTypes.getByName('release').signingConfig = releaseKey
    }
  }
}
`;

export function buildPublicAndroid({
  version,
  versionCode,
  outDir,
  credentialsFile,
  root = repoRoot,
  baseEnv = process.env,
}) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? "")) {
    throw new Error("--version must be numeric semver.");
  }
  if (!/^[1-9]\d*$/.test(versionCode ?? "") || Number(versionCode) > 2_100_000_000) {
    throw new Error("--version-code must be an integer from 1 to 2100000000.");
  }
  if (!outDir) throw new Error("--out-dir is required.");
  if (credentialsFile) {
    const file = NodePath.resolve(credentialsFile);
    const credentials = JSON.parse(NodeFS.readFileSync(file, "utf8"));
    for (const key of ["keystorePath", "keystorePassword", "keyAlias", "keyPassword"]) {
      if (typeof credentials[key] !== "string" || !credentials[key])
        throw new Error(`Signing credentials file requires ${key}.`);
    }
    baseEnv = {
      ...baseEnv,
      T3CODE_PUBLIC_ANDROID_KEYSTORE: NodePath.resolve(
        NodePath.dirname(file),
        credentials.keystorePath,
      ),
      T3CODE_PUBLIC_ANDROID_KEY_ALIAS: credentials.keyAlias,
      T3CODE_PUBLIC_ANDROID_STORE_PASSWORD: credentials.keystorePassword,
      T3CODE_PUBLIC_ANDROID_KEY_PASSWORD: credentials.keyPassword,
    };
  }
  for (const name of signingNames) {
    if (!baseEnv[name])
      throw new Error(`${name} is required; select the approved public signing key.`);
  }
  const keystore = NodePath.resolve(baseEnv.T3CODE_PUBLIC_ANDROID_KEYSTORE);
  if (!NodeFS.statSync(keystore).isFile())
    throw new Error("Public Android keystore must be a file.");
  const mobile = NodePath.join(root, "apps/mobile");
  const android = NodePath.join(mobile, "android");
  if (NodeFS.existsSync(android)) {
    throw new Error(
      "Use a disposable checkout without apps/mobile/android; native sources may have another identity.",
    );
  }
  const env = {
    ...baseEnv,
    APP_VARIANT: "production",
    T3CODE_BUILD_FLAVOR: "public",
    T3CODE_PUBLIC_RELEASE: "1",
    T3CODE_MOBILE_UPDATES_ENABLED: "0",
    T3CODE_MOBILE_APP_VERSION: version,
    T3CODE_ANDROID_VERSION_CODE: versionCode,
    T3CODE_PUBLIC_ANDROID_KEYSTORE: keystore,
    MOBILE_VERSION_POLICY: "appVersion",
    EXPO_NO_DOTENV: "1",
    CI: "1",
  };
  const run = (command, args, cwd, capture = false) => {
    const result = NodeChildProcess.spawnSync(command, args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `${command} failed (${result.status}).${capture ? `\n${result.stderr}` : ""}`,
      );
    return result.stdout;
  };
  const config = JSON.parse(
    run("vp", ["exec", "expo", "config", "--type", "public", "--json"], mobile, true),
  );
  if (
    config.android?.package !== "com.sergeserbinenko.t3pretty.app" ||
    config.version !== version ||
    config.android?.versionCode !== Number(versionCode) ||
    config.extra?.buildFlavor !== "public" ||
    config.updates?.enabled !== false ||
    config.extra?.relay?.url !== "https://relay.t3.codes" ||
    config.extra?.clerk?.publishableKey !== "pk_live_Y2xlcmsudDMuY29kZXMk" ||
    config.extra?.clerk?.jwtTemplate !== "t3-relay"
  ) {
    throw new Error("Resolved Expo config is not the requested public release with OTA disabled.");
  }
  const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-public-android-"));
  try {
    const init = NodePath.join(temporary, "signing.gradle");
    NodeFS.writeFileSync(init, publicAndroidSigningInit, { mode: 0o600 });
    run("vp", ["exec", "expo", "prebuild", "--platform", "android", "--no-install"], mobile);
    run(
      NodePath.join(android, "gradlew"),
      ["--no-daemon", "--init-script", init, ":app:assembleRelease", ":app:bundleRelease"],
      android,
    );
    const destination = NodePath.resolve(outDir);
    NodeFS.mkdirSync(destination, { recursive: true });
    for (const [source, extension] of [
      ["app/build/outputs/apk/release/app-release.apk", "apk"],
      ["app/build/outputs/bundle/release/app-release.aab", "aab"],
    ]) {
      NodeFS.copyFileSync(
        NodePath.join(android, source),
        NodePath.join(destination, `t3-pretty-${version}.${extension}`),
      );
    }
    process.stdout.write(
      `Built public APK and AAB ${version} (${versionCode}) in ${destination}. Verify signatures and test the signed APK before publication.\n`,
    );
  } finally {
    NodeFS.rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  try {
    const { values } = NodeUtil.parseArgs({
      options: {
        version: { type: "string" },
        "version-code": { type: "string" },
        "out-dir": { type: "string" },
        "credentials-file": { type: "string" },
      },
    });
    buildPublicAndroid({
      version: values.version,
      versionCode: values["version-code"],
      outDir: values["out-dir"],
      credentialsFile: values["credentials-file"],
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
