/**
 * SkillMaterializer — projects the enabled skill set into a workspace.
 *
 * At turn start the orchestration reactor calls `materialize` with the
 * thread's cwd and the union of globally and per-thread enabled skill ids.
 * Each skill is copied from the central store into `<cwd>/.claude/skills` and
 * `<cwd>/.agents/skills` under a sanitized directory name and marked with a
 * `.t3-managed` file containing the skill id. Only marked directories are
 * ever removed or overwritten — skills the user placed there themselves win
 * every collision, and no root is created while there is nothing to write.
 *
 * @module skills/SkillMaterializer
 */
import { SkillsError, type SkillId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

import * as SkillStore from "./SkillStore.ts";

/** Marker inside a materialized skill directory; content is the skill id. */
export const SKILL_MANAGED_MARKER_FILE = ".t3-managed";

/** Directory names a skill can materialize under, lowercase filesystem-safe. */
export function sanitizeSkillDirectoryName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export interface SkillMaterializeResult {
  readonly written: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
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
  }
>()("t3/skills/SkillMaterializer") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillStore = yield* SkillStore.SkillStore;

  const materialize = Effect.fn("SkillMaterializer.materialize")(function* (input: {
    readonly cwd: string;
    readonly skillIds: ReadonlyArray<SkillId>;
  }): Effect.fn.Return<SkillMaterializeResult, SkillsError> {
    const installed = new Map(
      (yield* skillStore.getState).installedSkills.map((skill) => [skill.id, skill] as const),
    );

    // Resolve every desired skill against the store up front; uninstalled or
    // invalid ids are skipped so one bad entry cannot block the rest.
    const desired: Array<{
      readonly id: SkillId;
      readonly dirName: string;
      readonly storeDir: string;
    }> = [];
    const seenDirNames = new Set<string>();
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
      const dirName = sanitizeSkillDirectoryName(skill.name);
      if (seenDirNames.has(dirName)) {
        yield* Effect.logWarning("Skipping skill with a colliding directory name", {
          skillId,
          dirName,
        });
        continue;
      }
      seenDirNames.add(dirName);
      desired.push({ id: skillId, dirName, storeDir });
    }

    const written: Array<string> = [];
    const removed: Array<string> = [];
    const roots = [
      path.join(input.cwd, ".claude", "skills"),
      path.join(input.cwd, ".agents", "skills"),
    ];

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
                yield* Effect.logWarning(
                  "Skipping skill materialization over a user-owned directory",
                  { skillId: skill.id, path: target },
                );
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
            written.push(target);
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

    return { written, removed } satisfies SkillMaterializeResult;
  });

  return SkillMaterializer.of({ materialize });
});

export const layer = Layer.effect(SkillMaterializer, make);
