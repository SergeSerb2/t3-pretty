import * as NodeOS from "node:os";

import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { expandHomePath } from "../../pathExpansion.ts";

const quotePath = Schema.encodeSync(Schema.fromJsonString(Schema.String));

/**
 * Resolve the Claude config directory the CLI would use: the instance's
 * `homePath` (exported as `CLAUDE_CONFIG_DIR`), then an inherited
 * `CLAUDE_CONFIG_DIR`, then Claude's default `~/.claude`. Empty must not
 * fall back to bare `$HOME` — that leftover from the old HOME override
 * produced a different continuation group than an explicit `~/.claude`.
 */
export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  if (homePath.length > 0) {
    return path.resolve(expandHomePath(homePath));
  }
  // Inherited env vars are not shell-expanded, so a literal `~` stays literal.
  const inherited = environment?.CLAUDE_CONFIG_DIR?.trim() ?? "";
  if (inherited.length > 0) {
    return path.resolve(inherited);
  }
  return path.resolve(path.join(NodeOS.homedir(), ".claude"));
});

export const makeClaudeEnvironment = Effect.fn("makeClaudeEnvironment")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const homePath = config.homePath.trim();
  if (homePath.length === 0) return resolvedBaseEnv;
  const resolvedHomePath = yield* resolveClaudeHomePath(config);
  return {
    ...resolvedBaseEnv,
    // Isolate this instance's config via CLAUDE_CONFIG_DIR rather than HOME.
    // Overriding HOME also relocates the macOS login keychain lookup
    // ($HOME/Library/Keychains), so the spawned CLI can't find its stored
    // OAuth credentials and reports "Not logged in". CLAUDE_CONFIG_DIR points
    // Claude Code at its config dir directly while leaving HOME (and the
    // keychain) intact.
    CLAUDE_CONFIG_DIR: resolvedHomePath,
  };
});

/**
 * Every Claude instance can continue every Claude thread: switching accounts
 * resumes the same native session after its transcript is copied into the
 * new config directory (see `importClaudeSessionTranscript`).
 */
export const CLAUDE_CONTINUATION_GROUP_KEY = "claude:portable-transcripts";

/**
 * Copy a Claude session transcript between config directories so a Claude
 * instance signed into another account can resume it. Claude stores sessions
 * at `projects/<cwd slug>/<session id>.jsonl` plus an optional sidecar
 * directory (subagents, tool results). The slug is copied verbatim rather
 * than recomputed so it always matches what the CLI wrote. The source is the
 * directory that ran the latest turn, so it replaces any older copy.
 */
export const importClaudeSessionTranscript = Effect.fn("importClaudeSessionTranscript")(
  function* (input: {
    readonly sessionId: string;
    readonly sourceConfigDir: string;
    readonly targetConfigDir: string;
  }): Effect.fn.Return<boolean, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sourceProjects = path.resolve(input.sourceConfigDir, "projects");
    const targetProjects = path.resolve(input.targetConfigDir, "projects");
    if (sourceProjects === targetProjects) return false;
    if (!(yield* fileSystem.exists(sourceProjects))) return false;

    const transcriptName = `${input.sessionId}.jsonl`;
    for (const projectSlug of yield* fileSystem.readDirectory(sourceProjects)) {
      const sourceTranscript = path.join(sourceProjects, projectSlug, transcriptName);
      if (!(yield* fileSystem.exists(sourceTranscript))) continue;
      const targetProject = path.join(targetProjects, projectSlug);
      yield* fileSystem.makeDirectory(targetProject, { recursive: true });
      yield* fileSystem.copyFile(sourceTranscript, path.join(targetProject, transcriptName));
      // Replace, not merge: leftovers from an older copy must not resurface.
      const sourceSidecar = path.join(sourceProjects, projectSlug, input.sessionId);
      const targetSidecar = path.join(targetProject, input.sessionId);
      yield* fileSystem.remove(targetSidecar, { recursive: true, force: true });
      if (yield* fileSystem.exists(sourceSidecar)) {
        yield* fileSystem.copy(sourceSidecar, targetSidecar);
      }
      return true;
    }
    return false;
  },
);

export const makeClaudeCapabilitiesCacheKey = Effect.fn("makeClaudeCapabilitiesCacheKey")(
  function* (
    config: Pick<ClaudeSettings, "binaryPath" | "homePath">,
    cwd?: string,
    environment?: NodeJS.ProcessEnv,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config, environment);
    return `${config.binaryPath}\0${resolvedHomePath}\0${cwd ?? ""}`;
  },
);

/**
 * Describe the spawned CLI's environment separately from the login command so
 * paths remain literal on every shell, including relative inherited values.
 */
export const claudeSignedOutMessage = (input: {
  readonly configDir: string | undefined;
  readonly cwd: string;
}): string => {
  const configuration =
    input.configDir !== undefined
      ? ` from ${quotePath(input.cwd)}, with CLAUDE_CONFIG_DIR set to ${quotePath(input.configDir)}`
      : "";
  return `Claude could not authenticate. For subscription login, run \`claude auth login\` on this environment's machine${configuration}, then start a new thread. For API-key authentication, check this instance's configured credentials.`;
};
