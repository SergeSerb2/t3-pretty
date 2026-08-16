/**
 * SkillStore — the server's central store of installed agent skills.
 *
 * Every skill lives at `<skillsDir>/<owner>--<repo>/<sourcePath...>/`, where
 * `sourcePath` is the skill directory relative to its marketplace repository
 * root, so a skill id (`"<owner>/<repo>:<sourcePath>"`) round-trips to exactly
 * one store location. Install writes a `.t3-skill.json` metadata file into the
 * skill directory; the materializer strips it again when copying into a
 * workspace.
 *
 * @module skills/SkillStore
 */
import {
  SkillsError,
  type InstalledSkill,
  type SkillId,
  type SkillsState,
} from "@t3tools/contracts";
import { parseSkillFrontmatter } from "@t3tools/shared/skillFrontmatter";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import * as ServerConfig from "../config.ts";

/** Install metadata kept inside each stored skill directory. */
export const SKILL_METADATA_FILE = ".t3-skill.json";
/** Marker inside a workspace copy of a skill; content is the skill id. */
export const SKILL_MANAGED_MARKER_FILE = ".t3-managed";

const SkillMetadata = Schema.Struct({ installedAt: Schema.String });
const SkillMetadataJson = fromLenientJson(SkillMetadata);
const SkillMetadataPrettyJson = fromJsonStringPretty(SkillMetadata);
const decodeSkillMetadata = Schema.decodeUnknownEffect(SkillMetadataJson);
const encodeSkillMetadata = Schema.encodeEffect(SkillMetadataPrettyJson);

/** Skills sit at most this deep below the repo dir; deeper trees are ignored. */
const STORE_SCAN_MAX_DEPTH = 8;

export interface ParsedSkillId {
  readonly owner: string;
  readonly repo: string;
  readonly sourceRepo: string;
  readonly sourcePath: string;
  readonly sourcePathSegments: ReadonlyArray<string>;
}

/**
 * One filesystem-safe path segment: no separators, no traversal, no leading
 * dot (dot-directories are skipped by every scan, so they cannot round-trip).
 */
function isSafeSegment(segment: string): boolean {
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

/** Validate an `"owner/repo"` marketplace source. */
export function parseSkillSourceRepo(
  sourceRepo: string,
): { readonly owner: string; readonly repo: string } | null {
  const parts = sourceRepo.split("/");
  if (parts.length !== 2 || !parts.every(isSafeSegment)) {
    return null;
  }
  return { owner: parts[0]!, repo: parts[1]! };
}

/** Validate a skill directory path relative to a repository root. */
export function parseSkillSourcePath(sourcePath: string): ReadonlyArray<string> | null {
  const segments = sourcePath.split("/");
  return segments.every(isSafeSegment) ? segments : null;
}

/** The `<owner>--<repo>` directory name used below `skillsDir`. */
export function formatSkillRepoDirName(owner: string, repo: string): string {
  return `${owner}--${repo}`;
}

/** Split a store repo dir name back into owner/repo (owner never contains `--`). */
function parseSkillRepoDirName(
  dirName: string,
): { readonly owner: string; readonly repo: string } | null {
  const separatorIndex = dirName.indexOf("--");
  if (separatorIndex <= 0 || separatorIndex >= dirName.length - 2) {
    return null;
  }
  const owner = dirName.slice(0, separatorIndex);
  const repo = dirName.slice(separatorIndex + 2);
  return isSafeSegment(owner) && isSafeSegment(repo) ? { owner, repo } : null;
}

/** Parse and validate a full skill id; `null` when any part is unsafe. */
export function parseSkillId(skillId: string): ParsedSkillId | null {
  const colonIndex = skillId.indexOf(":");
  if (colonIndex <= 0 || colonIndex === skillId.length - 1) {
    return null;
  }
  const sourceRepo = skillId.slice(0, colonIndex);
  const sourcePath = skillId.slice(colonIndex + 1);
  const repoParts = parseSkillSourceRepo(sourceRepo);
  const sourcePathSegments = parseSkillSourcePath(sourcePath);
  if (!repoParts || !sourcePathSegments) {
    return null;
  }
  return { ...repoParts, sourceRepo, sourcePath, sourcePathSegments };
}

export class SkillStore extends Context.Service<
  SkillStore,
  {
    /** Scan the store and return every installed skill. */
    readonly getState: Effect.Effect<SkillsState, SkillsError>;

    /**
     * Copy a directory containing a `SKILL.md` into the store location for
     * `sourceRepo`/`sourcePath`, replacing any existing install.
     */
    readonly installFromDirectory: (input: {
      readonly sourceRepo: string;
      readonly sourcePath: string;
      readonly directory: string;
    }) => Effect.Effect<SkillsState, SkillsError>;

    /** Remove an installed skill and return the fresh state. */
    readonly uninstall: (skillId: SkillId) => Effect.Effect<SkillsState, SkillsError>;

    /** Absolute path of an installed skill directory, for the materializer. */
    readonly resolveSkillDirectory: (skillId: SkillId) => Effect.Effect<string, SkillsError>;
  }
>()("t3/skills/SkillStore") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;

  const skillsRoot = path.resolve(config.skillsDir);

  /** Resolve a parsed id inside the store, or `null` when it escapes. */
  const resolveStoreLocation = (parsed: ParsedSkillId): string | null => {
    const candidate = path.resolve(
      skillsRoot,
      formatSkillRepoDirName(parsed.owner, parsed.repo),
      ...parsed.sourcePathSegments,
    );
    const relative = path.relative(skillsRoot, candidate);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }
    return candidate;
  };

  const invalidIdError = (operation: SkillsError["operation"], skillId: string) =>
    new SkillsError({ operation, message: `Invalid skill id: ${skillId}.` });

  const readInstalledAt = Effect.fn("SkillStore.readInstalledAt")(function* (skillDir: string) {
    const metadata = yield* fileSystem
      .readFileString(path.join(skillDir, SKILL_METADATA_FILE))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (metadata !== undefined) {
      const decoded = yield* decodeSkillMetadata(metadata).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      if (decoded !== undefined) {
        return decoded.installedAt;
      }
    }
    const info = yield* fileSystem.stat(skillDir).pipe(Effect.orElseSucceed(() => undefined));
    if (info && Option.isSome(info.mtime)) {
      return info.mtime.value.toISOString();
    }
    return DateTime.formatIso(yield* DateTime.now);
  });

  /**
   * Directories holding a `SKILL.md` below one repo dir, as sourcePath segment
   * lists. A skill directory is a leaf: nested `SKILL.md` files inside it
   * (examples, fixtures) are not separate installs.
   */
  const collectSkillDirs = Effect.fn("SkillStore.collectSkillDirs")(function* (
    directory: string,
    segments: ReadonlyArray<string>,
  ): Effect.fn.Return<Array<ReadonlyArray<string>>> {
    const entries = yield* fileSystem
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const found: Array<ReadonlyArray<string>> = [];
    for (const entry of [...entries].sort()) {
      if (entry.startsWith(".")) {
        continue;
      }
      const entryPath = path.join(directory, entry);
      const info = yield* fileSystem.stat(entryPath).pipe(Effect.orElseSucceed(() => undefined));
      if (!info || info.type !== "Directory") {
        continue;
      }
      const childSegments = [...segments, entry];
      const hasSkillFile = yield* fileSystem
        .exists(path.join(entryPath, "SKILL.md"))
        .pipe(Effect.orElseSucceed(() => false));
      if (hasSkillFile) {
        found.push(childSegments);
      } else if (childSegments.length < STORE_SCAN_MAX_DEPTH) {
        found.push(...(yield* collectSkillDirs(entryPath, childSegments)));
      }
    }
    return found;
  });

  // Infallible by construction: every filesystem read degrades to an empty
  // result so a partially broken store never takes down the state RPC.
  const getState: Effect.Effect<SkillsState, SkillsError> = Effect.gen(function* () {
    const repoDirNames = yield* fileSystem
      .readDirectory(skillsRoot)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

    const installedSkills: Array<InstalledSkill> = [];
    for (const repoDirName of [...repoDirNames].sort()) {
      const repoParts = parseSkillRepoDirName(repoDirName);
      if (!repoParts) {
        continue;
      }
      const repoDir = path.join(skillsRoot, repoDirName);
      const info = yield* fileSystem.stat(repoDir).pipe(Effect.orElseSucceed(() => undefined));
      if (!info || info.type !== "Directory") {
        continue;
      }
      const sourceRepo = `${repoParts.owner}/${repoParts.repo}`;
      for (const segments of yield* collectSkillDirs(repoDir, [])) {
        const sourcePath = segments.join("/");
        const skillDir = path.join(repoDir, ...segments);
        const contents = yield* fileSystem
          .readFileString(path.join(skillDir, "SKILL.md"))
          .pipe(Effect.orElseSucceed(() => ""));
        const frontmatter = parseSkillFrontmatter(contents);
        const directoryName = segments[segments.length - 1]!;
        installedSkills.push({
          id: `${sourceRepo}:${sourcePath}`,
          name:
            frontmatter.kind === "parsed" && frontmatter.name ? frontmatter.name : directoryName,
          ...(frontmatter.kind === "parsed" && frontmatter.description
            ? { description: frontmatter.description }
            : {}),
          sourceRepo,
          sourcePath,
          installedAt: yield* readInstalledAt(skillDir),
        });
      }
    }
    return { installedSkills } satisfies SkillsState;
  });

  const installFromDirectory = Effect.fn("SkillStore.installFromDirectory")(function* (input: {
    readonly sourceRepo: string;
    readonly sourcePath: string;
    readonly directory: string;
  }): Effect.fn.Return<SkillsState, SkillsError> {
    const toInstallError = (cause: unknown) =>
      new SkillsError({
        operation: "install",
        sourceRepo: input.sourceRepo,
        message: `Failed to install ${input.sourceRepo}:${input.sourcePath}.`,
        cause,
      });

    const repoParts = parseSkillSourceRepo(input.sourceRepo);
    const sourcePathSegments = parseSkillSourcePath(input.sourcePath);
    if (!repoParts || !sourcePathSegments) {
      return yield* invalidIdError("install", `${input.sourceRepo}:${input.sourcePath}`);
    }
    const parsed: ParsedSkillId = {
      ...repoParts,
      sourceRepo: input.sourceRepo,
      sourcePath: input.sourcePath,
      sourcePathSegments,
    };
    const hasSkillFile = yield* fileSystem
      .exists(path.join(input.directory, "SKILL.md"))
      .pipe(Effect.orElseSucceed(() => false));
    if (!hasSkillFile) {
      return yield* new SkillsError({
        operation: "install",
        sourceRepo: input.sourceRepo,
        message: `Cannot install ${input.sourceRepo}:${input.sourcePath}: the directory has no SKILL.md.`,
      });
    }
    const target = resolveStoreLocation(parsed);
    if (!target) {
      return yield* invalidIdError("install", `${input.sourceRepo}:${input.sourcePath}`);
    }

    yield* fileSystem
      .remove(target, { recursive: true, force: true })
      .pipe(Effect.mapError(toInstallError));
    yield* fileSystem
      .makeDirectory(path.dirname(target), { recursive: true })
      .pipe(Effect.mapError(toInstallError));
    yield* fileSystem.copy(input.directory, target).pipe(Effect.mapError(toInstallError));
    const metadata = yield* encodeSkillMetadata({
      installedAt: DateTime.formatIso(yield* DateTime.now),
    }).pipe(Effect.mapError(toInstallError));
    yield* fileSystem
      .writeFileString(path.join(target, SKILL_METADATA_FILE), metadata)
      .pipe(Effect.mapError(toInstallError));

    return yield* getState;
  });

  const uninstall = Effect.fn("SkillStore.uninstall")(function* (
    skillId: SkillId,
  ): Effect.fn.Return<SkillsState, SkillsError> {
    const parsed = parseSkillId(skillId);
    const target = parsed ? resolveStoreLocation(parsed) : null;
    if (!parsed || !target) {
      return yield* invalidIdError("uninstall", skillId);
    }
    const info = yield* fileSystem.stat(target).pipe(Effect.orElseSucceed(() => undefined));
    if (!info || info.type !== "Directory") {
      return yield* new SkillsError({
        operation: "uninstall",
        skillId,
        message: `Skill ${skillId} is not installed.`,
      });
    }

    yield* fileSystem.remove(target, { recursive: true, force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new SkillsError({
            operation: "uninstall",
            skillId,
            message: `Failed to uninstall ${skillId}.`,
            cause,
          }),
      ),
    );
    // Prune the now-empty ancestors up to (but excluding) the store root.
    let current = path.dirname(target);
    while (current.startsWith(`${skillsRoot}${path.sep}`)) {
      const remaining = yield* fileSystem
        .readDirectory(current)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (!remaining || remaining.length > 0) {
        break;
      }
      const removed = yield* fileSystem.remove(current, { recursive: true }).pipe(
        Effect.map(() => true),
        Effect.orElseSucceed(() => false),
      );
      if (!removed) {
        break;
      }
      current = path.dirname(current);
    }

    return yield* getState;
  });

  const resolveSkillDirectory = Effect.fn("SkillStore.resolveSkillDirectory")(function* (
    skillId: SkillId,
  ): Effect.fn.Return<string, SkillsError> {
    const parsed = parseSkillId(skillId);
    const target = parsed ? resolveStoreLocation(parsed) : null;
    if (!parsed || !target) {
      return yield* invalidIdError("read-store", skillId);
    }
    const info = yield* fileSystem.stat(target).pipe(Effect.orElseSucceed(() => undefined));
    if (!info || info.type !== "Directory") {
      return yield* new SkillsError({
        operation: "read-store",
        skillId,
        message: `Skill ${skillId} is not installed.`,
      });
    }
    return target;
  });

  return SkillStore.of({
    getState,
    installFromDirectory,
    uninstall,
    resolveSkillDirectory,
  });
});

export const layer = Layer.effect(SkillStore, make);
