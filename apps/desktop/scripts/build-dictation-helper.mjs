import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

// oxlint-disable-next-line t3code/no-global-process-runtime -- Native compilation targets the actual host.
const hostArch = process.arch;
// oxlint-disable-next-line t3code/no-global-process-runtime -- Native compilation only runs on macOS.
const hostPlatform = process.platform;

const { values } = NodeUtil.parseArgs({
  options: { output: { type: "string" }, arch: { type: "string", default: hostArch } },
});

function swiftTarget(arch) {
  switch (arch) {
    case "arm64":
      return "arm64-apple-macosx14.0";
    case "x64":
      return "x86_64-apple-macosx14.0";
    default:
      throw new Error(`Unsupported macOS architecture: ${arch}`);
  }
}

function compile(arch, output) {
  const root = NodeURL.fileURLToPath(new URL("../../../native/mac-dictation/", import.meta.url));
  const source = NodePath.resolve(root, "main.swift");
  const infoPlist = NodePath.resolve(root, "Info.plist");
  NodeFS.mkdirSync(NodePath.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    NodeChildProcess.execFileSync(
      "swiftc",
      [
        "-Osize",
        "-target",
        swiftTarget(arch),
        "-framework",
        "Speech",
        "-framework",
        "AVFoundation",
        "-Xlinker",
        "-sectcreate",
        "-Xlinker",
        "__TEXT",
        "-Xlinker",
        "__info_plist",
        "-Xlinker",
        infoPlist,
        source,
        "-o",
        temporary,
      ],
      { stdio: "inherit" },
    );
    NodeFS.chmodSync(temporary, 0o755);
    NodeFS.renameSync(temporary, output);
  } finally {
    NodeFS.rmSync(temporary, { force: true });
  }
}

function isCurrent(sourcePaths, output) {
  try {
    const outputTime = NodeFS.statSync(output).mtimeMs;
    return sourcePaths.every((file) => outputTime >= NodeFS.statSync(file).mtimeMs);
  } catch {
    return false;
  }
}

if (hostPlatform === "darwin") {
  const root = NodeURL.fileURLToPath(new URL("../../../native/mac-dictation/", import.meta.url));
  const source = NodePath.resolve(root, "main.swift");
  const infoPlist = NodePath.resolve(root, "Info.plist");
  const script = NodeURL.fileURLToPath(import.meta.url);
  const arch = values.arch;
  const output =
    values.output ??
    NodePath.resolve(
      root,
      "build",
      arch === "universal" ? "universal" : arch,
      "t3-dictation-helper",
    );
  if (arch === "universal") {
    const arm64 = `${output}.arm64`;
    const x64 = `${output}.x64`;
    if (!isCurrent([source, infoPlist, script], output)) {
      try {
        compile("arm64", arm64);
        compile("x64", x64);
        NodeChildProcess.execFileSync("lipo", ["-create", arm64, x64, "-o", output], {
          stdio: "inherit",
        });
        NodeFS.chmodSync(output, 0o755);
      } finally {
        NodeFS.rmSync(arm64, { force: true });
        NodeFS.rmSync(x64, { force: true });
      }
    }
  } else {
    if (!isCurrent([source, infoPlist, script], output)) {
      compile(arch, output);
    }
  }
}
