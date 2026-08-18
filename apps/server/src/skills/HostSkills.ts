/**
 * HostSkills — user-scope, plugin, bundled, and system skill folders the
 * provider CLIs load themselves.
 *
 * T3's store is a separate library. Codex, Claude Code, Cursor, Grok, and
 * OpenCode also load skills from their own home `skills/` directories, from
 * installed plugins, from bundled/system packs, and from the shared
 * `~/.agents/skills` folder. This service scans those locations on the
 * environment host (including nested plugin-shaped trees), hides a skill from
 * those CLIs without deleting it (by renaming `SKILL.md` to
 * `SKILL.md.t3-disabled`), and deletes a user-owned folder when the user
 * uninstalls it from Settings. Plugin, bundled, and system skills can be
 * hidden the same way but are not deleted. Clients address rows by the opaque
 * ids minted here; a client-supplied path never crosses the wire inbound.
 *
 * @module skills/HostSkills
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";

import {
  HostSkillId,
  ProviderDriverKind,
  ProviderInstanceId,
  SkillsError,
  type HostSkill,
  type HostSkillsState,
} from "@t3tools/contracts";
import { parseSkillFrontmatter } from "@t3tools/shared/skillFrontmatter";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { expandHomePath } from "../pathExpansion.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  collectProviderExtraRoots,
  collectSkillDocuments,
  DEFAULT_INSTANCE_KEY,
  formatHostSkillId,
  HOST_SKILL_DISABLED_FILE,
  isSafeSegment,
  joinSkillRelPath,
  parseHostSkillId,
  SHARED_ORIGIN_KEY,
  SKILL_FILE,
  toPosixRelPath,
  type DriverOriginKey,
  type HostSkillRoot,
} from "./HostSkillInventory.ts";
import { SKILL_MANAGED_MARKER_FILE } from "./SkillStore.ts";

export {
  formatHostSkillId,
  HOST_SKILL_DISABLED_FILE,
  parseHostSkillId,
} from "./HostSkillInventory.ts";

function joinHome(...segments: ReadonlyArray<string>): string {
  return [NodeOS.homedir(), ...segments].join("/");
}

function configuredHomePath(config: unknown): string {
  if (typeof config !== "object" || config === null) {
    return "";
  }
  const value = (config as Record<string, unknown>).homePath;
  return typeof value === "string" ? value.trim() : "";
}

const DRIVER_CONVENTIONS: ReadonlyArray<{
  readonly originKey: DriverOriginKey;
  readonly title: string;
  readonly defaultDirectory: (environment: NodeJS.ProcessEnv) => string;
}> = [
  {
    originKey: "codex",
    title: "Codex",
    defaultDirectory: () => joinHome(".codex"),
  },
  {
    originKey: "claudeAgent",
    title: "Claude Code",
    defaultDirectory: (environment) => {
      const environmentConfigDir = environment.CLAUDE_CONFIG_DIR?.trim() ?? "";
      return environmentConfigDir.length > 0 ? environmentConfigDir : joinHome(".claude");
    },
  },
  {
    originKey: "cursor",
    title: "Cursor",
    defaultDirectory: () => joinHome(".cursor"),
  },
  {
    originKey: "grok",
    title: "Grok",
    defaultDirectory: () => joinHome(".grok"),
  },
  {
    originKey: "opencode",
    title: "OpenCode",
    defaultDirectory: (environment) => {
      const xdgConfigHome = environment.XDG_CONFIG_HOME?.trim() ?? "";
      const configRoot = xdgConfigHome.length > 0 ? xdgConfigHome : joinHome(".config");
      return `${configRoot}/opencode`;
    },
  },
];

export class HostSkills extends Context.Service<
  HostSkills,
  {
    readonly list: Effect.Effect<HostSkillsState, SkillsError>;
    /**
     * Resolve specific host skill ids to their on-disk directories without
     * scanning every configured provider home. Used by materialization so a
     * thread that picks one host skill does not pay for a full inventory.
     */
    readonly resolve: (
      skillIds: ReadonlyArray<string>,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly id: string; readonly name: string; readonly dir: string }>,
      SkillsError
    >;
    readonly uninstall: (skillId: HostSkillId) => Effect.Effect<HostSkillsState, SkillsError>;
    readonly setEnabled: (input: {
      readonly skillId: HostSkillId;
      readonly enabled: boolean;
    }) => Effect.Effect<HostSkillsState, SkillsError>;
  }
>()("t3/skills/HostSkills") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverSettings = yield* ServerSettingsService;

  const abbreviateHome = (absolutePath: string): string => {
    const home = NodeOS.homedir();
    return absolutePath === home || absolutePath.startsWith(`${home}${path.sep}`)
      ? `~${absolutePath.slice(home.length)}`
      : absolutePath;
  };

  const invalidIdError = (operation: SkillsError["operation"], skillId: string) =>
    new SkillsError({ operation, skillId, message: `Invalid host skill id: ${skillId}.` });

  const collectRoots = Effect.fn("HostSkills.collectRoots")(function* (
    operation: SkillsError["operation"],
  ) {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new SkillsError({
            operation,
            message: "Failed to read server settings while listing host skills.",
            cause,
          }),
      ),
    );

    const roots: Array<HostSkillRoot> = [];
    const seenDirectories = new Set<string>();
    const addRoot = (root: HostSkillRoot) => {
      if (seenDirectories.has(root.directory)) {
        return;
      }
      seenDirectories.add(root.directory);
      roots.push(root);
    };

    const addHome = Effect.fn("HostSkills.addHome")(function* (input: {
      readonly originKey: DriverOriginKey;
      readonly origin: string;
      readonly instanceKey: string;
      readonly driver: ProviderDriverKind;
      readonly instanceId?: ProviderInstanceId;
      readonly home: string;
    }): Effect.fn.Return<void> {
      addRoot({
        originKey: input.originKey,
        origin: input.origin,
        instanceKey: input.instanceKey,
        driver: input.driver,
        directory: path.join(input.home, "skills"),
        kind: "user",
        canUninstall: true,
        ...(input.instanceId ? { instanceId: input.instanceId } : {}),
      });
      for (const extra of yield* collectProviderExtraRoots(fileSystem, path, {
        originKey: input.originKey,
        origin: input.origin,
        driver: input.driver,
        home: input.home,
        homeInstanceKey: input.instanceKey,
        ...(input.instanceId ? { instanceId: input.instanceId } : {}),
      })) {
        addRoot(extra);
      }
    });

    for (const convention of DRIVER_CONVENTIONS) {
      // No tilde expansion: an env-provided config dir reaches the CLI
      // verbatim, so this must scan the same directory the CLI would.
      const defaultHome = path.resolve(convention.defaultDirectory(process.env));
      const driver = ProviderDriverKind.make(convention.originKey);
      yield* addHome({
        originKey: convention.originKey,
        origin: convention.title,
        instanceKey: DEFAULT_INSTANCE_KEY,
        driver,
        home: defaultHome,
      });

      for (const [instanceId, instance] of Object.entries(settings.providerInstances)) {
        if (instance.driver !== convention.originKey || !isSafeSegment(instanceId)) {
          continue;
        }
        const homePath = configuredHomePath(instance.config);
        if (homePath.length === 0) {
          continue;
        }
        const instanceHome = path.resolve(expandHomePath(homePath));
        const displayName = instance.displayName?.trim();
        yield* addHome({
          originKey: convention.originKey,
          origin:
            displayName && displayName.length > 0
              ? `${convention.title} · ${displayName}`
              : convention.title,
          instanceKey: instanceId,
          driver,
          instanceId: ProviderInstanceId.make(instanceId),
          home: instanceHome,
        });
      }
    }

    addRoot({
      originKey: SHARED_ORIGIN_KEY,
      origin: "Shared",
      instanceKey: DEFAULT_INSTANCE_KEY,
      directory: path.join(path.resolve(joinHome(".agents")), "skills"),
      kind: "user",
      canUninstall: true,
    });

    return roots;
  });

  const scanRoot = Effect.fn("HostSkills.scanRoot")(function* (root: HostSkillRoot) {
    const documents = yield* collectSkillDocuments(fileSystem, path, root.directory);
    const skills: Array<HostSkill> = [];

    for (const document of documents) {
      const isManagedCopy = yield* fileSystem
        .exists(path.join(document.dir, SKILL_MANAGED_MARKER_FILE))
        .pipe(Effect.orElseSucceed(() => false));
      if (isManagedCopy) {
        continue;
      }

      const frontmatter = parseSkillFrontmatter(document.contents);
      const fallbackName = document.relPath.split("/").at(-1) ?? document.relPath;
      const name =
        frontmatter.kind === "parsed" && frontmatter.name ? frontmatter.name : fallbackName;
      const skill: HostSkill = {
        id: formatHostSkillId({
          originKey: root.originKey,
          instanceKey: root.instanceKey,
          dirName: document.relPath,
        }),
        name,
        path: document.enabled ? document.skillFilePath : document.disabledFilePath,
        displayPath: abbreviateHome(document.dir),
        origin: root.origin,
        enabled: document.enabled,
        kind: root.kind,
        canUninstall: root.canUninstall,
        ...(root.driver ? { driver: root.driver } : {}),
        ...(root.instanceId ? { instanceId: root.instanceId } : {}),
        ...(frontmatter.kind === "parsed" && frontmatter.description
          ? { description: frontmatter.description }
          : {}),
      };
      skills.push(skill);
    }

    return skills;
  });

  const list: Effect.Effect<HostSkillsState, SkillsError> = Effect.gen(function* () {
    const roots = yield* collectRoots("list-host");
    const skills: Array<HostSkill> = [];
    const seenPaths = new Set<string>();
    for (const root of roots) {
      for (const skill of yield* scanRoot(root)) {
        const skillDirectory = path.dirname(skill.path);
        const canonical = yield* fileSystem
          .realPath(skillDirectory)
          .pipe(Effect.orElseSucceed(() => skillDirectory));
        if (seenPaths.has(canonical) || seenPaths.has(skill.path)) {
          continue;
        }
        seenPaths.add(canonical);
        seenPaths.add(skill.path);
        skills.push(skill);
      }
    }
    skills.sort((left, right) => {
      const originOrder = left.origin.localeCompare(right.origin);
      return originOrder !== 0 ? originOrder : left.name.localeCompare(right.name);
    });
    return { skills } satisfies HostSkillsState;
  });

  const resolve = Effect.fn("HostSkills.resolve")(function* (skillIds: ReadonlyArray<string>) {
    const roots = yield* collectRoots("materialize");
    const resolved: Array<{ id: string; name: string; dir: string }> = [];
    for (const skillId of skillIds) {
      const parsed = parseHostSkillId(skillId);
      if (!parsed) {
        continue;
      }
      const root = roots.find(
        (candidate) =>
          candidate.originKey === parsed.originKey && candidate.instanceKey === parsed.instanceKey,
      );
      if (!root) {
        continue;
      }
      const target = joinSkillRelPath(root.directory, parsed.dirName, path);
      if (toPosixRelPath(root.directory, target, path) !== parsed.dirName) {
        continue;
      }
      const info = yield* fileSystem.stat(target).pipe(Effect.orElseSucceed(() => undefined));
      if (!info || info.type !== "Directory") {
        continue;
      }
      const skillFilePath = path.join(target, SKILL_FILE);
      const disabledFilePath = path.join(target, HOST_SKILL_DISABLED_FILE);
      const skillContents = yield* fileSystem
        .readFileString(skillFilePath)
        .pipe(Effect.orElseSucceed(() => undefined));
      const disabledContents =
        skillContents === undefined
          ? yield* fileSystem
              .readFileString(disabledFilePath)
              .pipe(Effect.orElseSucceed(() => undefined))
          : undefined;
      if (skillContents === undefined && disabledContents === undefined) {
        continue;
      }
      const isManagedCopy = yield* fileSystem
        .exists(path.join(target, SKILL_MANAGED_MARKER_FILE))
        .pipe(Effect.orElseSucceed(() => false));
      if (isManagedCopy) {
        continue;
      }
      const frontmatter = parseSkillFrontmatter(skillContents ?? disabledContents ?? "");
      resolved.push({
        id: skillId,
        name: frontmatter.kind === "parsed" && frontmatter.name ? frontmatter.name : parsed.dirName,
        dir: target,
      });
    }
    return resolved;
  });

  const resolveTarget = Effect.fn("HostSkills.resolveTarget")(function* (
    operation: SkillsError["operation"],
    skillId: string,
  ) {
    const parsed = parseHostSkillId(skillId);
    if (!parsed) {
      return yield* invalidIdError(operation, skillId);
    }
    const roots = yield* collectRoots(operation);
    const root = roots.find(
      (candidate) =>
        candidate.originKey === parsed.originKey && candidate.instanceKey === parsed.instanceKey,
    );
    if (!root) {
      return yield* new SkillsError({
        operation,
        skillId,
        message: `Host skill ${skillId} is not installed.`,
      });
    }
    const target = joinSkillRelPath(root.directory, parsed.dirName, path);
    if (toPosixRelPath(root.directory, target, path) !== parsed.dirName) {
      return yield* invalidIdError(operation, skillId);
    }
    return { root, target, dirName: parsed.dirName } as const;
  });

  const inspectTarget = Effect.fn("HostSkills.inspectTarget")(function* (
    operation: SkillsError["operation"],
    skillId: string,
    target: string,
  ) {
    const info = yield* fileSystem.stat(target).pipe(Effect.orElseSucceed(() => undefined));
    if (!info || info.type !== "Directory") {
      return yield* new SkillsError({
        operation,
        skillId,
        message: `Host skill ${skillId} is not installed.`,
      });
    }
    const skillFilePath = path.join(target, SKILL_FILE);
    const disabledFilePath = path.join(target, HOST_SKILL_DISABLED_FILE);
    const hasSkillFile = yield* fileSystem
      .exists(skillFilePath)
      .pipe(Effect.orElseSucceed(() => false));
    const hasDisabledFile = yield* fileSystem
      .exists(disabledFilePath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!hasSkillFile && !hasDisabledFile) {
      return yield* new SkillsError({
        operation,
        skillId,
        message: `Host skill ${skillId} is not a skill directory.`,
      });
    }
    const isManagedCopy = yield* fileSystem
      .exists(path.join(target, SKILL_MANAGED_MARKER_FILE))
      .pipe(Effect.orElseSucceed(() => false));
    if (isManagedCopy) {
      return yield* new SkillsError({
        operation,
        skillId,
        message: `Host skill ${skillId} is managed by T3 Code's skill library.`,
      });
    }
    return { skillFilePath, disabledFilePath, hasSkillFile, hasDisabledFile } as const;
  });

  const uninstall = Effect.fn("HostSkills.uninstall")(function* (skillId: HostSkillId) {
    const { root, target } = yield* resolveTarget("uninstall-host", skillId);
    if (!root.canUninstall) {
      return yield* new SkillsError({
        operation: "uninstall-host",
        skillId,
        message: `Host skill ${skillId} is owned by a plugin or the provider CLI and cannot be deleted from T3 Code.`,
      });
    }
    yield* inspectTarget("uninstall-host", skillId, target);

    const symlinkTarget = yield* fileSystem
      .readLink(target)
      .pipe(Effect.orElseSucceed(() => undefined));
    const remove =
      symlinkTarget === undefined
        ? fileSystem.remove(target, { recursive: true, force: true })
        : fileSystem.remove(target);
    yield* remove.pipe(
      Effect.mapError(
        (cause) =>
          new SkillsError({
            operation: "uninstall-host",
            skillId,
            message: `Failed to uninstall ${skillId}.`,
            cause,
          }),
      ),
    );

    return yield* list;
  });

  const setEnabled = Effect.fn("HostSkills.setEnabled")(function* (input: {
    readonly skillId: HostSkillId;
    readonly enabled: boolean;
  }) {
    const { target } = yield* resolveTarget("set-host-enabled", input.skillId);
    const documents = yield* inspectTarget("set-host-enabled", input.skillId, target);
    const alreadyEnabled = documents.hasSkillFile;
    if (input.enabled === alreadyEnabled) {
      return yield* list;
    }

    const source = input.enabled ? documents.disabledFilePath : documents.skillFilePath;
    const destination = input.enabled ? documents.skillFilePath : documents.disabledFilePath;
    if (!input.enabled && documents.hasDisabledFile) {
      yield* fileSystem.remove(documents.disabledFilePath).pipe(
        Effect.mapError(
          (cause) =>
            new SkillsError({
              operation: "set-host-enabled",
              skillId: input.skillId,
              message: `Failed to update ${input.skillId}.`,
              cause,
            }),
        ),
      );
    }
    yield* fileSystem.rename(source, destination).pipe(
      Effect.mapError(
        (cause) =>
          new SkillsError({
            operation: "set-host-enabled",
            skillId: input.skillId,
            message: `Failed to update ${input.skillId}.`,
            cause,
          }),
      ),
    );

    return yield* list;
  });

  return HostSkills.of({ list, resolve, uninstall, setEnabled });
});

export const layer = Layer.effect(HostSkills, make);
