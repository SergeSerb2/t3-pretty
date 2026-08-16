/**
 * SkillMaterializer — projects the enabled skill set into a workspace and
 * resolves the skill documents a turn should carry.
 *
 * At turn start the orchestration reactor calls `materialize` with the
 * thread's cwd and the union of globally and per-thread enabled skill ids.
 * Each skill is copied from the central store into `<cwd>/.claude/skills` and
 * `<cwd>/.agents/skills` under a sanitized directory name and marked with a
 * `.t3-managed` file containing the skill id. Only marked directories are
 * ever removed or overwritten — a user-owned folder that already contains a
 * readable `SKILL.md` wins the name, and no root is created while there is
 * nothing to write.
 * Every managed directory also carries a `.gitignore` that hides it from git,
 * so agent commits and `git status` never pick up the copies.
 *
 * Copying only makes a skill *discoverable* by the provider CLI; nothing puts
 * its instructions in front of the agent. `materialize` therefore also returns
 * each loaded skill's `SKILL.md` body, and `resolveMentions` reads the bodies
 * of `$skill` mentions (provider CLI skills, or skills already in the
 * workspace roots), so the reactor can send them with the turn.
 *
 * @module skills/SkillMaterializer
 */
import { SkillsError, type SkillId } from "@t3tools/contracts";
import { SKILL_FRONTMATTER_PATTERN } from "@t3tools/shared/skillFrontmatter";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

import * as SkillStore from "./SkillStore.ts";

/** Marker inside a materialized skill directory; content is the skill id. */
export const SKILL_MANAGED_MARKER_FILE = ".t3-managed";
/** Written into every managed directory so git ignores the copy wholesale. */
const SKILL_MANAGED_GITIGNORE = "*\n";
const SKILL_FILE = "SKILL.md";
/** Workspace roots provider CLIs scan for project skills, in write order. */
const WORKSPACE_SKILL_ROOTS = [
  [".claude", "skills"],
  [".agents", "skills"],
] as const;

/** Directory names a skill can materialize under, lowercase filesystem-safe. */
export function sanitizeSkillDirectoryName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/**
 * Map each skill to a workspace folder. Unique names keep the unsuffixed
 * form; a name shared by more than one skill folds in source identity so
 * the mapping is the same regardless of input order.
 */
export function assignSkillDirectoryNames(
  skills: ReadonlyArray<{
    readonly id: SkillId;
    readonly name: string;
    readonly sourceRepo: string;
    readonly sourcePath: string;
  }>,
): ReadonlyMap<SkillId, string> {
  const groups = new Map<string, Array<(typeof skills)[number]>>();
  for (const skill of skills) {
    const baseName = sanitizeSkillDirectoryName(skill.name);
    const group = groups.get(baseName);
    if (group) {
      group.push(skill);
    } else {
      groups.set(baseName, [skill]);
    }
  }

  const assigned = new Map<SkillId, string>();
  for (const [baseName, group] of groups) {
    if (group.length === 1) {
      assigned.set(group[0]!.id, baseName);
      continue;
    }
    assignCollidingSkillDirectories(baseName, group, assigned);
  }
  return assigned;
}

function assignCollidingSkillDirectories(
  baseName: string,
  group: ReadonlyArray<{
    readonly id: SkillId;
    readonly name: string;
    readonly sourceRepo: string;
    readonly sourcePath: string;
  }>,
  assigned: Map<SkillId, string>,
): void {
  const byRepo = new Map<string, Array<(typeof group)[number]>>();
  for (const skill of group) {
    const dirName = `${baseName}--${sanitizeSkillDirectoryName(skill.sourceRepo)}`;
    const members = byRepo.get(dirName);
    if (members) {
      members.push(skill);
    } else {
      byRepo.set(dirName, [skill]);
    }
  }

  for (const [repoDirName, repoGroup] of byRepo) {
    if (repoGroup.length === 1) {
      assigned.set(repoGroup[0]!.id, repoDirName);
      continue;
    }

    const byPath = new Map<string, Array<(typeof repoGroup)[number]>>();
    for (const skill of repoGroup) {
      const dirName = `${repoDirName}--${sanitizeSkillDirectoryName(skill.sourcePath)}`;
      const members = byPath.get(dirName);
      if (members) {
        members.push(skill);
      } else {
        byPath.set(dirName, [skill]);
      }
    }

    for (const [pathDirName, pathGroup] of byPath) {
      if (pathGroup.length === 1) {
        assigned.set(pathGroup[0]!.id, pathDirName);
        continue;
      }
      // Distinct ids can still sanitize to the same string; suffix in id order.
      const sorted = [...pathGroup].sort((left, right) => (left.id < right.id ? -1 : 1));
      sorted.forEach((skill, index) => {
        assigned.set(skill.id, index === 0 ? pathDirName : `${pathDirName}-${index + 1}`);
      });
    }
  }
}

/** Case-insensitive match on a skill's name or its directory-safe form. */
export function skillNameMatches(candidate: string, mention: string): boolean {
  const normalizedMention = mention.trim().toLowerCase();
  return (
    candidate.trim().toLowerCase() === normalizedMention ||
    sanitizeSkillDirectoryName(candidate) === sanitizeSkillDirectoryName(mention)
  );
}

/** `SKILL.md` with its YAML frontmatter removed; the frontmatter is metadata for pickers, not instructions. */
export function skillBodyFromDocument(contents: string): string {
  return contents.replace(SKILL_FRONTMATTER_PATTERN, "").trim();
}

/** A skill document ready to be sent with a turn. */
export interface SkillDocument {
  readonly name: string;
  /** Absolute directory holding `SKILL.md`; relative paths in the body resolve against it. */
  readonly directory: string;
  readonly body: string;
}

export interface SkillMaterializeResult {
  readonly written: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly loaded: ReadonlyArray<SkillDocument & { readonly id: SkillId }>;
}

export class SkillMaterializer extends Context.Service<
  SkillMaterializer,
  {
    /**
     * Reconcile `.claude/skills` and `.agents/skills` under `cwd` with the
     * desired skill ids. Best-effort per skill: one failing skill never fails
     * the others.
     */
    readonly materialize: (input: {
      readonly cwd: string;
      readonly skillIds: ReadonlyArray<SkillId>;
    }) => Effect.Effect<SkillMaterializeResult, SkillsError>;

    /**
     * Resolve `$skill` mentions to documents: the workspace roots under
     * `cwd` first, then `candidates` (the provider snapshot's skills, name +
     * `SKILL.md` path). Unresolvable names are dropped. Best-effort: never
     * fails.
     */
    readonly resolveMentions: (input: {
      readonly cwd: string | undefined;
      readonly names: ReadonlyArray<string>;
      readonly candidates: ReadonlyArray<{ readonly name: string; readonly path: string }>;
    }) => Effect.Effect<ReadonlyArray<SkillDocument>>;
  }
>()("t3/skills/SkillMaterializer") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillStore = yield* SkillStore.SkillStore;

  /**
   * Read a skill document from either its directory or its `SKILL.md` path.
   * Returns undefined when nothing readable is there.
   */
  const readSkillDocument = Effect.fn("SkillMaterializer.readSkillDocument")(function* (
    name: string,
    location: string,
  ): Effect.fn.Return<SkillDocument | undefined> {
    const info = yield* fileSystem.stat(location).pipe(Effect.orElseSucceed(() => undefined));
    if (!info) {
      return undefined;
    }
    const filePath = info.type === "Directory" ? path.join(location, SKILL_FILE) : location;
    const contents = yield* fileSystem
      .readFileString(filePath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (contents === undefined) {
      return undefined;
    }
    return { name, directory: path.dirname(filePath), body: skillBodyFromDocument(contents) };
  });

  const materialize = Effect.fn("SkillMaterializer.materialize")(function* (input: {
    readonly cwd: string;
    readonly skillIds: ReadonlyArray<SkillId>;
  }): Effect.fn.Return<SkillMaterializeResult, SkillsError> {
    const installed = new Map(
      (yield* skillStore.getState).installedSkills.map((skill) => [skill.id, skill] as const),
    );

    // Resolve every desired skill against the store up front; uninstalled or
    // invalid ids are skipped so one bad entry cannot block the rest.
    const resolved: Array<{
      readonly id: SkillId;
      readonly name: string;
      readonly sourceRepo: string;
      readonly sourcePath: string;
      readonly storeDir: string;
    }> = [];
    for (const skillId of input.skillIds) {
      const skill = installed.get(skillId);
      if (!skill) {
        yield* Effect.logWarning("Skipping skill that is not installed", { skillId });
        continue;
      }
      const storeDir = yield* skillStore.resolveSkillDirectory(skillId).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Skipping skill that failed to resolve", {
            skillId,
            detail: error.message,
          }).pipe(Effect.as(undefined)),
        ),
      );
      if (storeDir === undefined) {
        continue;
      }
      resolved.push({
        id: skillId,
        name: skill.name,
        sourceRepo: skill.sourceRepo,
        sourcePath: skill.sourcePath,
        storeDir,
      });
    }
    const directoryNames = assignSkillDirectoryNames(resolved);
    const desired = resolved.map((skill) => ({
      id: skill.id,
      name: skill.name,
      dirName: directoryNames.get(skill.id) ?? sanitizeSkillDirectoryName(skill.name),
      storeDir: skill.storeDir,
    }));

    const written: Array<string> = [];
    const removed: Array<string> = [];
    // First workspace directory holding each skill (T3's copy or the user's
    // own colliding one); absent means no root has it.
    const loadedDirs = new Map<SkillId, string>();
    const roots = WORKSPACE_SKILL_ROOTS.map((segments) => path.join(input.cwd, ...segments));

    for (const root of roots) {
      yield* Effect.gen(function* () {
        const entries = yield* fileSystem
          .readDirectory(root)
          .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

        // Managed dirs carry the marker; anything without it is user-owned.
        const managedDirNames = new Set<string>();
        for (const entry of entries) {
          const entryPath = path.join(root, entry);
          const info = yield* fileSystem
            .stat(entryPath)
            .pipe(Effect.orElseSucceed(() => undefined));
          if (!info || info.type !== "Directory") {
            continue;
          }
          const hasMarker = yield* fileSystem
            .exists(path.join(entryPath, SKILL_MANAGED_MARKER_FILE))
            .pipe(Effect.orElseSucceed(() => false));
          if (hasMarker) {
            managedDirNames.add(entry);
          }
        }

        // Zero footprint: nothing desired and nothing managed means the root
        // is left alone, including never being created.
        if (desired.length === 0 && managedDirNames.size === 0) {
          return;
        }

        const desiredDirNames = new Set(desired.map((skill) => skill.dirName));
        for (const dirName of managedDirNames) {
          if (desiredDirNames.has(dirName)) {
            continue;
          }
          const target = path.join(root, dirName);
          const outcome = yield* fileSystem
            .remove(target, { recursive: true, force: true })
            .pipe(Effect.result);
          if (Result.isSuccess(outcome)) {
            removed.push(target);
          } else {
            yield* Effect.logWarning("Failed to remove a stale managed skill", {
              path: target,
              cause: outcome.failure,
            });
          }
        }

        for (const skill of desired) {
          const target = path.join(root, skill.dirName);
          yield* Effect.gen(function* () {
            if (managedDirNames.has(skill.dirName)) {
              yield* fileSystem.remove(target, { recursive: true, force: true });
            } else {
              const existing = yield* fileSystem
                .stat(target)
                .pipe(Effect.orElseSucceed(() => undefined));
              if (existing !== undefined) {
                // Do not overwrite a user-owned path. Only claim it as the
                // loaded copy when it is a directory with a readable SKILL.md;
                // otherwise a later workspace root can still materialize.
                yield* Effect.logWarning("Skipping skill materialization over a user-owned path", {
                  skillId: skill.id,
                  path: target,
                });
                if (existing.type === "Directory" && !loadedDirs.has(skill.id)) {
                  const document = yield* readSkillDocument(skill.name, target);
                  if (document !== undefined) {
                    loadedDirs.set(skill.id, target);
                  }
                }
                return;
              }
            }
            yield* fileSystem.makeDirectory(root, { recursive: true });
            yield* fileSystem.copy(skill.storeDir, target);
            // Store metadata is store-local; the marker carries the id instead.
            yield* fileSystem
              .remove(path.join(target, SkillStore.SKILL_METADATA_FILE), { force: true })
              .pipe(Effect.orElseSucceed(() => undefined));
            yield* fileSystem.writeFileString(
              path.join(target, SKILL_MANAGED_MARKER_FILE),
              skill.id,
            );
            yield* fileSystem.writeFileString(
              path.join(target, ".gitignore"),
              SKILL_MANAGED_GITIGNORE,
            );
            written.push(target);
            if (!loadedDirs.has(skill.id)) {
              loadedDirs.set(skill.id, target);
            }
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Failed to materialize a skill", {
                skillId: skill.id,
                path: target,
                cause,
              }),
            ),
          );
        }
      });
    }

    const loaded: Array<SkillDocument & { readonly id: SkillId }> = [];
    for (const skill of desired) {
      const directory = loadedDirs.get(skill.id);
      if (directory === undefined) {
        continue;
      }
      const document = yield* readSkillDocument(skill.name, directory);
      if (document === undefined) {
        continue;
      }
      loaded.push({ id: skill.id, ...document });
    }

    return { written, removed, loaded } satisfies SkillMaterializeResult;
  });

  const resolveMentions = Effect.fn("SkillMaterializer.resolveMentions")(function* (input: {
    readonly cwd: string | undefined;
    readonly names: ReadonlyArray<string>;
    readonly candidates: ReadonlyArray<{ readonly name: string; readonly path: string }>;
  }): Effect.fn.Return<ReadonlyArray<SkillDocument>> {
    const resolved: Array<SkillDocument> = [];
    const cwd = input.cwd;
    for (const name of input.names) {
      if (resolved.some((document) => skillNameMatches(document.name, name))) {
        continue;
      }
      // Project roots beat the provider's own list, matching how the CLIs
      // resolve a name (project scope over user scope): the snapshot is
      // discovered from the server cwd and can point at another project's
      // copy of a same-named skill.
      const candidate = input.candidates.find((skill) => skillNameMatches(skill.name, name));
      const locations = [
        ...(cwd === undefined
          ? []
          : WORKSPACE_SKILL_ROOTS.flatMap((segments) => [
              { name, location: path.join(cwd, ...segments, name) },
              { name, location: path.join(cwd, ...segments, sanitizeSkillDirectoryName(name)) },
            ])),
        ...(candidate ? [{ name: candidate.name, location: candidate.path }] : []),
      ];
      for (const entry of locations) {
        const document = yield* readSkillDocument(entry.name, entry.location);
        if (document !== undefined) {
          resolved.push(document);
          break;
        }
      }
    }
    return resolved;
  });

  return SkillMaterializer.of({ materialize, resolveMentions });
});

export const layer = Layer.effect(SkillMaterializer, make);
