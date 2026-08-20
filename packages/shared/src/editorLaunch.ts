import { type EditorId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { resolveCommandPath } from "./shell.ts";

/**
 * Cursor's agent installer puts an executable shim at `~/.local/bin/cursor`.
 * PATH discovery treats that as the IDE, then `cursor /folder` exits 1 with
 * "No Cursor IDE installation found" on ignored stderr — Open looks like a
 * success and nothing opens. Both markers are required so the real app CLI
 * (`Cursor CLI not found`) is not skipped.
 */
const CURSOR_AGENT_SHIM_MARKERS = [
  "No Cursor IDE installation found",
  "Use 'cursor agent'",
] as const;

const WINDOWS_PATH_DELIMITER = ";";
const POSIX_PATH_DELIMITER = ":";

export function isCursorAgentShimContents(contents: string): boolean {
  return CURSOR_AGENT_SHIM_MARKERS.every((marker) => contents.includes(marker));
}

function pathDelimiterForPlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? WINDOWS_PATH_DELIMITER : POSIX_PATH_DELIMITER;
}

function readEnvPath(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? env.Path ?? env.path ?? "";
}

function homeDirFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const home = env.HOME ?? env.USERPROFILE;
  const trimmed = home?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function expandEditorCliPath(value: string, env: NodeJS.ProcessEnv): string | undefined {
  if (value.startsWith("~/")) {
    const home = homeDirFromEnv(env);
    if (home === undefined) return undefined;
    return `${home}${value.slice(1)}`;
  }
  if (value.includes("%LOCALAPPDATA%")) {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (!localAppData) return undefined;
    return value.replaceAll("%LOCALAPPDATA%", localAppData);
  }
  return value;
}

const DARWIN_EDITOR_APP_CLIS: Partial<Record<EditorId, readonly string[]>> = {
  cursor: [
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    "~/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
  ],
  vscode: [
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    "~/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
  ],
  "vscode-insiders": [
    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
    "~/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
  ],
  vscodium: [
    "/Applications/VSCodium.app/Contents/Resources/app/bin/codium",
    "~/Applications/VSCodium.app/Contents/Resources/app/bin/codium",
  ],
  zed: ["/Applications/Zed.app/Contents/MacOS/cli", "~/Applications/Zed.app/Contents/MacOS/cli"],
};

const WIN32_EDITOR_APP_CLIS: Partial<Record<EditorId, readonly string[]>> = {
  cursor: [
    "%LOCALAPPDATA%\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd",
    "%LOCALAPPDATA%\\Programs\\Cursor\\resources\\app\\bin\\cursor.cmd",
  ],
  vscode: ["%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code.cmd"],
  "vscode-insiders": [
    "%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\bin\\code-insiders.cmd",
  ],
  vscodium: ["%LOCALAPPDATA%\\Programs\\VSCodium\\bin\\codium.cmd"],
};

/**
 * App-bundle CLI paths used when PATH has no usable IDE binary.
 * Finder-launched desktop apps often miss those PATH entries too.
 */
export function extraEditorCliPaths(input: {
  readonly editorId: EditorId;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
}): readonly string[] {
  const templates =
    input.platform === "darwin"
      ? DARWIN_EDITOR_APP_CLIS[input.editorId]
      : input.platform === "win32"
        ? WIN32_EDITOR_APP_CLIS[input.editorId]
        : undefined;
  if (templates === undefined) return [];

  const resolved: string[] = [];
  for (const template of templates) {
    const expanded = expandEditorCliPath(template, input.env);
    if (expanded !== undefined) resolved.push(expanded);
  }
  return resolved;
}

const isCursorAgentShimAtPath = Effect.fn("editorLaunch.isCursorAgentShimAtPath")(function* (
  commandName: string,
  filePath: string,
): Effect.fn.Return<boolean, never, FileSystem.FileSystem> {
  if (commandName !== "cursor") return false;
  const fileSystem = yield* FileSystem.FileSystem;
  const contents = yield* fileSystem.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
  return isCursorAgentShimContents(contents);
});

/**
 * Resolves the IDE executable to spawn for Open-in-editor. Walks each listed
 * command across PATH (preferred name first), skipping the Cursor agent shim,
 * then well-known app-bundle locations. Returns the absolute path so launch
 * does not re-walk PATH and land on the agent shim.
 */
export const resolveEditorExecutable = Effect.fn("editorLaunch.resolveEditorExecutable")(
  function* (input: {
    readonly editorId: EditorId;
    readonly commands: readonly string[];
    readonly platform: NodeJS.Platform;
    readonly env: NodeJS.ProcessEnv;
  }): Effect.fn.Return<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> {
    const path = yield* Path.Path;
    const delimiter = pathDelimiterForPlatform(input.platform);
    const pathEntries = readEnvPath(input.env)
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const seen = new Set<string>();
    const tryCandidate = Effect.fn("editorLaunch.tryCandidate")(function* (candidate: string) {
      if (seen.has(candidate)) return Option.none<string>();
      seen.add(candidate);
      const resolved = yield* resolveCommandPath(candidate, { env: input.env }).pipe(
        Effect.map(Option.some),
        Effect.catchTag("CommandResolutionError", () => Effect.succeed(Option.none<string>())),
      );
      if (Option.isNone(resolved)) return Option.none<string>();
      const executable = resolved.value;
      const commandName = (executable.split(/[/\\]/).pop() ?? executable).replace(/\.cmd$/i, "");
      if (yield* isCursorAgentShimAtPath(commandName, executable)) return Option.none<string>();
      return Option.some(executable);
    });

    for (const command of input.commands) {
      for (const pathEntry of pathEntries) {
        const hit = yield* tryCandidate(path.join(pathEntry, command));
        if (Option.isSome(hit)) return hit;
      }
    }

    for (const extra of extraEditorCliPaths({
      editorId: input.editorId,
      platform: input.platform,
      env: input.env,
    })) {
      const hit = yield* tryCandidate(extra);
      if (Option.isSome(hit)) return hit;
    }

    return Option.none();
  },
);
