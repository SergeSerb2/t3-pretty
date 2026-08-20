import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { describe, expect, it } from "vite-plus/test";

import {
  extraEditorCliPaths,
  isCursorAgentShimContents,
  resolveEditorExecutable,
} from "./editorLaunch.ts";

const CURSOR_AGENT_SHIM = `#!/bin/sh
set -eu
echo "Error: No Cursor IDE installation found. Use 'cursor agent' or 'agent' to run the agent." 1>&2
echo "Or, install Cursor at https://cursor.com/download" 1>&2
exit 1
`;

const CURSOR_IDE_CLI = `#!/usr/bin/env bash
# ELECTRON_RUN_AS_NODE
echo "Error: Cursor CLI not found. Please install Cursor properly." 1>&2
exit 1
`;

describe("isCursorAgentShimContents", () => {
  it("detects the agent installer shim", () => {
    expect(isCursorAgentShimContents(CURSOR_AGENT_SHIM)).toBe(true);
  });

  it("does not treat the IDE CLI as a shim", () => {
    expect(isCursorAgentShimContents(CURSOR_IDE_CLI)).toBe(false);
  });
});

describe("extraEditorCliPaths", () => {
  it("expands macOS app-bundle paths", () => {
    expect(
      extraEditorCliPaths({
        editorId: "cursor",
        platform: "darwin",
        env: { HOME: "/Users/ada" },
      }),
    ).toEqual([
      "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
      "/Users/ada/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    ]);
  });

  it("expands Windows LocalAppData paths", () => {
    expect(
      extraEditorCliPaths({
        editorId: "cursor",
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" },
      }),
    ).toEqual([
      "C:\\Users\\ada\\AppData\\Local\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd",
      "C:\\Users\\ada\\AppData\\Local\\Programs\\Cursor\\resources\\app\\bin\\cursor.cmd",
    ]);
  });

  it("omits home-relative paths when HOME is missing", () => {
    expect(
      extraEditorCliPaths({
        editorId: "cursor",
        platform: "darwin",
        env: {},
      }),
    ).toEqual(["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"]);
  });
});

effectIt.layer(NodeServices.layer)("resolveEditorExecutable", (it) => {
  it.effect("skips the Cursor agent shim and uses a later PATH IDE CLI", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editor-launch-" });
      const shimDir = path.join(root, "shim");
      const ideDir = path.join(root, "ide");
      yield* fileSystem.makeDirectory(shimDir);
      yield* fileSystem.makeDirectory(ideDir);
      const shimPath = path.join(shimDir, "cursor");
      const idePath = path.join(ideDir, "cursor");
      yield* fileSystem.writeFileString(shimPath, CURSOR_AGENT_SHIM);
      yield* fileSystem.writeFileString(idePath, CURSOR_IDE_CLI);
      yield* fileSystem.chmod(shimPath, 0o755);
      yield* fileSystem.chmod(idePath, 0o755);

      const resolved = yield* resolveEditorExecutable({
        editorId: "cursor",
        commands: ["cursor"],
        platform: "linux",
        env: { PATH: `${shimDir}:${ideDir}` },
      });

      expect(Option.getOrNull(resolved)).toBe(idePath);
    }).pipe(Effect.scoped),
  );

  it.effect("falls back to a well-known app CLI when PATH only has the shim", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editor-app-" });
      const shimDir = path.join(root, "shim");
      const appBin = path.join(
        root,
        "Applications",
        "Cursor.app",
        "Contents",
        "Resources",
        "app",
        "bin",
      );
      yield* fileSystem.makeDirectory(shimDir);
      yield* fileSystem.makeDirectory(appBin, { recursive: true });
      const shimPath = path.join(shimDir, "cursor");
      const appCli = path.join(appBin, "cursor");
      yield* fileSystem.writeFileString(shimPath, CURSOR_AGENT_SHIM);
      yield* fileSystem.writeFileString(appCli, CURSOR_IDE_CLI);
      yield* fileSystem.chmod(shimPath, 0o755);
      yield* fileSystem.chmod(appCli, 0o755);

      const resolved = yield* resolveEditorExecutable({
        editorId: "cursor",
        commands: ["cursor"],
        platform: "darwin",
        env: { PATH: shimDir, HOME: root },
      });

      const resolvedPath = Option.getOrNull(resolved);
      expect(resolvedPath).not.toBe(shimPath);
      expect(resolvedPath === appCli || resolvedPath?.includes("Cursor.app")).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("prefers the first listed command name even if a fallback is earlier on PATH", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editor-order-" });
      const fallbackDir = path.join(root, "fallback");
      const preferredDir = path.join(root, "preferred");
      yield* fileSystem.makeDirectory(fallbackDir);
      yield* fileSystem.makeDirectory(preferredDir);
      const fallbackPath = path.join(fallbackDir, "zeditor");
      const preferredPath = path.join(preferredDir, "zed");
      yield* fileSystem.writeFileString(fallbackPath, "#!/bin/sh\nexit 0\n");
      yield* fileSystem.writeFileString(preferredPath, "#!/bin/sh\nexit 0\n");
      yield* fileSystem.chmod(fallbackPath, 0o755);
      yield* fileSystem.chmod(preferredPath, 0o755);

      const resolved = yield* resolveEditorExecutable({
        editorId: "zed",
        commands: ["zed", "zeditor"],
        platform: "linux",
        env: { PATH: `${fallbackDir}:${preferredDir}` },
      });

      expect(Option.getOrNull(resolved)).toBe(preferredPath);
    }).pipe(Effect.scoped),
  );

  it.effect("skips a Cursor agent shim with a Windows executable suffix", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const shimDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-editor-shim-exe-",
      });
      const shimPath = path.join(shimDir, "cursor.exe");
      yield* fileSystem.writeFileString(shimPath, CURSOR_AGENT_SHIM);
      yield* fileSystem.chmod(shimPath, 0o755);

      const resolved = yield* resolveEditorExecutable({
        editorId: "cursor",
        commands: ["cursor"],
        platform: "linux",
        env: { PATH: shimDir },
      });

      expect(Option.isNone(resolved)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("resolves a Windows PATHEXT CLI from a joined PATH directory", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editor-pathext-" });
      const cliPath = path.join(binDir, "code.CMD");
      yield* fileSystem.writeFileString(cliPath, "@echo off\r\n");

      const resolved = yield* resolveEditorExecutable({
        editorId: "vscode",
        commands: ["code"],
        platform: "win32",
        env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      });

      expect(Option.getOrNull(resolved)).toBe(cliPath);
    }).pipe(Effect.scoped),
  );

  it.effect("does not treat the agent shim as an installed IDE", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const shimDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editor-shim-only-" });
      const shimPath = path.join(shimDir, "cursor");
      yield* fileSystem.writeFileString(shimPath, CURSOR_AGENT_SHIM);
      yield* fileSystem.chmod(shimPath, 0o755);

      const resolved = yield* resolveEditorExecutable({
        editorId: "cursor",
        commands: ["cursor"],
        platform: "linux",
        env: { PATH: shimDir },
      });

      expect(Option.isNone(resolved)).toBe(true);
    }).pipe(Effect.scoped),
  );
});
