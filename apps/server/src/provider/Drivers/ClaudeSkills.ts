/**
 * ClaudeSkills — filesystem discovery of Claude Code skills for the `$` picker.
 *
 * Claude Code loads skills from `<config dir>/skills` (user scope), installed
 * plugin `skills/` trees, then `<cwd>/.agents/skills` and `<cwd>/.claude/skills`
 * (project scope). A skill is a directory with a `SKILL.md` carrying YAML
 * frontmatter; plugin-shaped trees nest one level deeper
 * (`superpowers/skills/using-superpowers`). Later roots win on name collisions,
 * so precedence is user, plugins, `.agents`, then `.claude`.
 * The Agent SDK init handshake surfaces skills only as slash commands without
 * their filesystem paths, so the provider snapshot scans the same locations
 * directly, mirroring how the Codex app-server reports its skills.
 *
 * @module provider/Drivers/ClaudeSkills
 */
import * as NodeOS from "node:os";

import type { ClaudeSettings, ServerProviderSkill } from "@t3tools/contracts";
import { parseSkillFrontmatter } from "@t3tools/shared/skillFrontmatter";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { expandHomePath } from "../../pathExpansion.ts";
import {
  collectSkillDocuments,
  parseClaudeInstalledPluginInstallPaths,
} from "../../skills/HostSkillInventory.ts";

type ClaudeSkillScope = "user" | "project";

/**
 * Resolve the Claude config directory the CLI would use, matching the
 * precedence the spawned CLI sees: the instance's `homePath` (exported as
 * `CLAUDE_CONFIG_DIR` by `makeClaudeEnvironment`), then a `CLAUDE_CONFIG_DIR`
 * already present in the process environment, then `~/.claude`.
 */
const resolveClaudeConfigDirPath = Effect.fn("resolveClaudeConfigDirPath")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  environment: NodeJS.ProcessEnv,
  cwd?: string,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  if (homePath.length > 0) {
    return path.resolve(expandHomePath(homePath));
  }
  // No tilde expansion here: the spawned CLI receives this env var verbatim
  // (env vars are never shell-expanded), so a literal `~` must stay literal
  // for discovery to scan the same directory the runtime would. A relative
  // value is resolved against the workspace cwd — the subprocess's own cwd —
  // for the same reason.
  const environmentConfigDir = environment.CLAUDE_CONFIG_DIR?.trim() ?? "";
  if (environmentConfigDir.length > 0) {
    return cwd ? path.resolve(cwd, environmentConfigDir) : path.resolve(environmentConfigDir);
  }
  return path.join(NodeOS.homedir(), ".claude");
});

/**
 * Enumerate Claude Code skills from the user config dir, installed plugins,
 * workspace `.agents/skills`, and workspace `.claude/skills`, in that order.
 * Discovery is best-effort: unreadable roots and malformed skill entries are
 * skipped so a broken skill never degrades the provider snapshot. On name
 * collisions, later roots win: plugins beat loose user skills, `.agents` beats
 * those, and `.claude` beats `.agents`, matching Claude Code's resolution.
 */
export const discoverClaudeSkills = Effect.fn("discoverClaudeSkills")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  cwd?: string,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configDirPath = yield* resolveClaudeConfigDirPath(config, environment ?? process.env, cwd);

  const pluginDirectories: Array<string> = [];
  const pluginsJson = yield* fileSystem
    .readFileString(path.join(configDirPath, "plugins", "installed_plugins.json"))
    .pipe(Effect.orElseSucceed(() => undefined));
  if (pluginsJson !== undefined) {
    for (const plugin of parseClaudeInstalledPluginInstallPaths(pluginsJson)) {
      pluginDirectories.push(path.join(plugin.installPath, "skills"));
    }
  }

  const roots: ReadonlyArray<{ directory: string; scope: ClaudeSkillScope }> = [
    { directory: path.join(configDirPath, "skills"), scope: "user" },
    ...pluginDirectories.map((directory) => ({ directory, scope: "user" as const })),
    ...(cwd
      ? [
          { directory: path.join(cwd, ".agents", "skills"), scope: "project" as const },
          { directory: path.join(cwd, ".claude", "skills"), scope: "project" as const },
        ]
      : []),
  ];

  const skillsByName = new Map<string, ServerProviderSkill>();
  for (const root of roots) {
    for (const document of yield* collectSkillDocuments(fileSystem, path, root.directory)) {
      if (!document.enabled) {
        continue;
      }

      const frontmatter = parseSkillFrontmatter(document.contents);
      // Malformed frontmatter means the skill won't load in Claude Code
      // either — skip it rather than surfacing a broken entry under its
      // directory name.
      if (frontmatter.kind === "malformed") {
        continue;
      }

      const fallbackName = document.relPath.split("/").at(-1) ?? document.relPath;
      const name = (frontmatter.kind === "parsed" ? frontmatter.name : undefined) ?? fallbackName;
      if (!name) {
        continue;
      }

      skillsByName.set(name, {
        name,
        path: document.skillFilePath,
        enabled: true,
        scope: root.scope,
        ...(frontmatter.kind === "parsed" && frontmatter.description
          ? { description: frontmatter.description }
          : {}),
      });
    }
  }

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});
