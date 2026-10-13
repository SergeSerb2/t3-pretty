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
} else {
  throw new Error(`Unknown probe mode: ${mode}`);
}
