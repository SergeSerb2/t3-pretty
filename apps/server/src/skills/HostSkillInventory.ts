/**
 * HostSkillInventory — parse provider plugin registries and walk skill trees.
 *
 * HostSkills lists more than the top-level `skills/` folders the CLIs also
 * scan as loose user installs. Installed plugins, bundled packs, and
 * plugin-shaped trees (`superpowers/skills/using-superpowers/SKILL.md`)
 * live one or more directories deeper. This module is the shared walker
 * and the registry parsers; HostSkills decides which roots to scan.
 *
 * @module skills/HostSkillInventory
 */
import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const HOST_SKILL_ID_PREFIX = "host:";
/** Built-in root marker; empty so no configured ProviderInstanceId can collide with it. */
export const DEFAULT_INSTANCE_KEY = "";
export const SHARED_ORIGIN_KEY = "agents";
export const SKILL_FILE = "SKILL.md";
/** Providers only discover a file named exactly `SKILL.md`; this hides one. */
export const HOST_SKILL_DISABLED_FILE = "SKILL.md.t3-disabled";
export const HOST_PLUGIN_INSTANCE_PREFIX = "_p_";
export const HOST_BUNDLED_INSTANCE_KEY = "_bundled";
export const HOST_SYSTEM_INSTANCE_KEY = "_system";

const SKIP_DIRECTORY_NAMES = new Set(["node_modules", "dist", "coverage", "__pycache__", "vendor"]);
const MAX_SKILL_TREE_DEPTH = 5;
const MAX_REL_PATH_SEGMENTS = 12;

export type DriverOriginKey = "claudeAgent" | "codex" | "cursor" | "grok" | "opencode";
export type HostSkillOriginKey = DriverOriginKey | typeof SHARED_ORIGIN_KEY;
export type HostSkillKind = "user" | "plugin" | "bundled" | "system";

export const DRIVER_ORIGIN_KEYS = new Set<string>([
  "claudeAgent",
  "codex",
  "cursor",
  "grok",
  "opencode",
]);

export interface HostSkillRoot {
  readonly originKey: HostSkillOriginKey;
  readonly origin: string;
  readonly instanceKey: string;
  readonly driver?: ProviderDriverKind;
  readonly instanceId?: ProviderInstanceId;
  readonly directory: string;
  readonly kind: HostSkillKind;
  readonly canUninstall: boolean;
}

export interface ParsedHostSkillId {
  readonly originKey: HostSkillOriginKey;
  readonly instanceKey: string;
  readonly dirName: string;
}

export interface DiscoveredSkillDocument {
  readonly dir: string;
  readonly relPath: string;
  readonly enabled: boolean;
  readonly contents: string;
  readonly skillFilePath: string;
  readonly disabledFilePath: string;
}

export interface CodexEnabledPluginRef {
  readonly name: string;
  readonly marketplace: string;
}

/**
 * One filesystem-safe path segment: no separators, no traversal, no leading
 * dot (dot-directories are skipped by the scan, so they cannot round-trip).
 */
export function isSafeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.startsWith(".") &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    !segment.includes("\0") &&
    !segment.includes(":")
  );
}

/** Relative skill path under a scan root (`grill-me` or `superpowers/skills/using-superpowers`). */
export function isSafeRelPath(relPath: string): boolean {
  if (
    relPath.length === 0 ||
    relPath.startsWith("/") ||
    relPath.includes("\\") ||
    relPath.includes("\0")
  ) {
    return false;
  }
  const segments = relPath.split("/");
  return (
    segments.length > 0 &&
    segments.length <= MAX_REL_PATH_SEGMENTS &&
    segments.every((segment) => isSafeSegment(segment))
  );
}

export function parseHostSkillId(skillId: string): ParsedHostSkillId | null {
  if (!skillId.startsWith(HOST_SKILL_ID_PREFIX)) {
    return null;
  }
  const rest = skillId.slice(HOST_SKILL_ID_PREFIX.length);
  const firstColon = rest.indexOf(":");
  if (firstColon <= 0) {
    return null;
  }
  const originKey = rest.slice(0, firstColon);
  if (!DRIVER_ORIGIN_KEYS.has(originKey) && originKey !== SHARED_ORIGIN_KEY) {
    return null;
  }
  const afterOrigin = rest.slice(firstColon + 1);
  const secondColon = afterOrigin.indexOf(":");
  if (secondColon === -1) {
    if (!isSafeRelPath(afterOrigin)) {
      return null;
    }
    return {
      originKey: originKey as HostSkillOriginKey,
      instanceKey: DEFAULT_INSTANCE_KEY,
      dirName: afterOrigin,
    };
  }
  const instanceKey = afterOrigin.slice(0, secondColon);
  const dirName = afterOrigin.slice(secondColon + 1);
  if (!isSafeSegment(instanceKey) || !isSafeRelPath(dirName)) {
    return null;
  }
  return {
    originKey: originKey as HostSkillOriginKey,
    instanceKey,
    dirName,
  };
}

export function formatHostSkillId(input: {
  readonly originKey: HostSkillOriginKey;
  readonly instanceKey: string;
  readonly dirName: string;
}): string {
  return input.instanceKey === DEFAULT_INSTANCE_KEY
    ? `${HOST_SKILL_ID_PREFIX}${input.originKey}:${input.dirName}`
    : `${HOST_SKILL_ID_PREFIX}${input.originKey}:${input.instanceKey}:${input.dirName}`;
}

export function joinSkillRelPath(rootDirectory: string, relPath: string, path: Path.Path): string {
  return path.resolve(rootDirectory, ...relPath.split("/"));
}

export function toPosixRelPath(
  rootDirectory: string,
  absolutePath: string,
  path: Path.Path,
): string {
  return path.relative(rootDirectory, absolutePath).split(path.sep).join("/");
}

export function pluginInstanceKey(label: string, homeInstanceKey = DEFAULT_INSTANCE_KEY): string {
  const slug = label
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const homePrefix = homeInstanceKey.length > 0 ? `${homeInstanceKey}-` : "";
  return `${HOST_PLUGIN_INSTANCE_PREFIX}${homePrefix}${slug.length > 0 ? slug : "plugin"}`;
}

export function scopedExtraInstanceKey(
  base: string,
  homeInstanceKey = DEFAULT_INSTANCE_KEY,
): string {
  return homeInstanceKey.length === 0 ? base : `${base}-${homeInstanceKey}`;
}

export function parseClaudeInstalledPluginInstallPaths(
  raw: string,
): ReadonlyArray<{ readonly id: string; readonly installPath: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const plugins = (parsed as { plugins?: unknown }).plugins;
  if (typeof plugins !== "object" || plugins === null) {
    return [];
  }
  const found: Array<{ id: string; installPath: string }> = [];
  for (const [id, value] of Object.entries(plugins as Record<string, unknown>)) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const installPath = (entry as { installPath?: unknown }).installPath;
      if (typeof installPath === "string" && installPath.trim().length > 0) {
        found.push({ id, installPath: installPath.trim() });
      }
    }
  }
  return found;
}

export function parseGrokInstalledPluginRoots(
  raw: string,
): ReadonlyArray<{ readonly id: string; readonly path: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const repos = (parsed as { repos?: unknown }).repos;
  if (typeof repos !== "object" || repos === null) {
    return [];
  }
  const found: Array<{ id: string; path: string }> = [];
  for (const [id, value] of Object.entries(repos as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const repoPath = (value as { path?: unknown }).path;
    if (typeof repoPath === "string" && repoPath.trim().length > 0) {
      found.push({ id, path: repoPath.trim() });
    }
  }
  return found;
}

export function parseCodexEnabledPluginRefs(raw: string): ReadonlyArray<CodexEnabledPluginRef> {
  const refs: Array<CodexEnabledPluginRef> = [];
  const seen = new Set<string>();
  const tablePattern = /\[plugins\."([^"\n]+)"\]\s*([^[]*)/g;
  for (const match of raw.matchAll(tablePattern)) {
    const id = match[1];
    const body = match[2] ?? "";
    if (!id) {
      continue;
    }
    const at = id.lastIndexOf("@");
    if (at <= 0 || at === id.length - 1) {
      continue;
    }
    if (/\benabled\s*=\s*false\b/.test(body)) {
      continue;
    }
    const name = id.slice(0, at).trim();
    const marketplace = id.slice(at + 1).trim();
    if (name.length === 0 || marketplace.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    refs.push({ name, marketplace });
  }
  return refs;
}

export function pickPluginVersionDirectory(names: ReadonlyArray<string>): string | undefined {
  const usable = names.filter((name) => isSafeSegment(name) || name === "latest");
  if (usable.includes("latest")) {
    return "latest";
  }
  const sorted = [...usable].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
  return sorted.at(-1);
}

export const collectSkillDocuments = Effect.fn("collectSkillDocuments")(function* (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  directory: string,
  options: { readonly maxDepth?: number } = {},
): Effect.fn.Return<ReadonlyArray<DiscoveredSkillDocument>> {
  const maxDepth = options.maxDepth ?? MAX_SKILL_TREE_DEPTH;
  const discovered: Array<DiscoveredSkillDocument> = [];
  const queue: Array<{ directory: string; relPrefix: string; depth: number }> = [
    { directory, relPrefix: "", depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    const entries = yield* fileSystem
      .readDirectory(current.directory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    for (const entry of [...entries].sort()) {
      if (SKIP_DIRECTORY_NAMES.has(entry) || !isSafeSegment(entry)) {
        continue;
      }
      const skillDir = path.join(current.directory, entry);
      const info = yield* fileSystem.stat(skillDir).pipe(Effect.orElseSucceed(() => undefined));
      if (!info || info.type !== "Directory") {
        continue;
      }
      const relPath = current.relPrefix.length === 0 ? entry : `${current.relPrefix}/${entry}`;
      if (!isSafeRelPath(relPath)) {
        continue;
      }
      const skillFilePath = path.join(skillDir, SKILL_FILE);
      const disabledFilePath = path.join(skillDir, HOST_SKILL_DISABLED_FILE);
      const skillContents = yield* fileSystem
        .readFileString(skillFilePath)
        .pipe(Effect.orElseSucceed(() => undefined));
      const disabledContents =
        skillContents === undefined
          ? yield* fileSystem
              .readFileString(disabledFilePath)
              .pipe(Effect.orElseSucceed(() => undefined))
          : undefined;
      if (skillContents !== undefined || disabledContents !== undefined) {
        discovered.push({
          dir: skillDir,
          relPath,
          enabled: skillContents !== undefined,
          contents: skillContents ?? disabledContents ?? "",
          skillFilePath,
          disabledFilePath,
        });
        continue;
      }
      if (current.depth < maxDepth) {
        queue.push({ directory: skillDir, relPrefix: relPath, depth: current.depth + 1 });
      }
    }
  }

  return discovered;
});

export interface ProviderHomeExtraRootsInput {
  readonly originKey: DriverOriginKey;
  readonly origin: string;
  readonly driver: ProviderDriverKind;
  readonly instanceId?: ProviderInstanceId;
  readonly homeInstanceKey: string;
  readonly home: string;
}

export const collectProviderExtraRoots = Effect.fn("collectProviderExtraRoots")(function* (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  input: ProviderHomeExtraRootsInput,
): Effect.fn.Return<ReadonlyArray<HostSkillRoot>> {
  const roots: Array<HostSkillRoot> = [];

  const addIfDirectory = Effect.fn("collectProviderExtraRoots.addIfDirectory")(function* (
    root: HostSkillRoot,
  ): Effect.fn.Return<void> {
    const info = yield* fileSystem.stat(root.directory).pipe(Effect.orElseSucceed(() => undefined));
    if (info?.type === "Directory") {
      roots.push(root);
    }
  });

  const pluginRoot = (directory: string, label: string): HostSkillRoot => ({
    originKey: input.originKey,
    origin: input.origin,
    instanceKey: pluginInstanceKey(label, input.homeInstanceKey),
    driver: input.driver,
    directory,
    kind: "plugin",
    canUninstall: false,
    ...(input.instanceId ? { instanceId: input.instanceId } : {}),
  });

  if (input.originKey === "claudeAgent") {
    const pluginsJson = yield* fileSystem
      .readFileString(path.join(input.home, "plugins", "installed_plugins.json"))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (pluginsJson !== undefined) {
      for (const plugin of parseClaudeInstalledPluginInstallPaths(pluginsJson)) {
        yield* addIfDirectory(pluginRoot(path.join(plugin.installPath, "skills"), plugin.id));
      }
    }
  }

  if (input.originKey === "codex") {
    yield* addIfDirectory({
      originKey: input.originKey,
      origin: input.origin,
      instanceKey: scopedExtraInstanceKey(HOST_SYSTEM_INSTANCE_KEY, input.homeInstanceKey),
      driver: input.driver,
      directory: path.join(input.home, "skills", ".system"),
      kind: "system",
      canUninstall: false,
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
    });
    const configToml = yield* fileSystem
      .readFileString(path.join(input.home, "config.toml"))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (configToml !== undefined) {
      for (const plugin of parseCodexEnabledPluginRefs(configToml)) {
        const pluginHome = path.join(
          input.home,
          "plugins",
          "cache",
          plugin.marketplace,
          plugin.name,
        );
        const versions = yield* fileSystem
          .readDirectory(pluginHome)
          .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
        const version = pickPluginVersionDirectory(versions);
        if (version === undefined) {
          continue;
        }
        yield* addIfDirectory(
          pluginRoot(
            path.join(pluginHome, version, "skills"),
            `${plugin.name}@${plugin.marketplace}`,
          ),
        );
      }
    }
  }

  if (input.originKey === "cursor") {
    yield* addIfDirectory({
      originKey: input.originKey,
      origin: input.origin,
      instanceKey: scopedExtraInstanceKey(HOST_SYSTEM_INSTANCE_KEY, input.homeInstanceKey),
      driver: input.driver,
      directory: path.join(input.home, "skills-cursor"),
      kind: "system",
      canUninstall: false,
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
    });
  }

  if (input.originKey === "grok") {
    yield* addIfDirectory({
      originKey: input.originKey,
      origin: input.origin,
      instanceKey: scopedExtraInstanceKey(HOST_BUNDLED_INSTANCE_KEY, input.homeInstanceKey),
      driver: input.driver,
      directory: path.join(input.home, "bundled", "skills"),
      kind: "bundled",
      canUninstall: false,
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
    });
    const registryJson = yield* fileSystem
      .readFileString(path.join(input.home, "installed-plugins", "registry.json"))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (registryJson !== undefined) {
      for (const repo of parseGrokInstalledPluginRoots(registryJson)) {
        yield* addIfDirectory(pluginRoot(path.join(repo.path, "skills"), repo.id));
      }
    }
  }

  return roots;
});
