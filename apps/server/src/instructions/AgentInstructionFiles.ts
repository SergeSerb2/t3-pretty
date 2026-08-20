/**
 * AgentInstructionFiles — server-side resolution and IO for the markdown
 * guidance files coding agents load (`AGENTS.md`, `CLAUDE.md`, …).
 *
 * Clients address files by the opaque ids this service mints (`global:codex`,
 * `global:claudeAgent:work`, `project:AGENTS.md`); every read/write re-resolves
 * the id against the current provider settings, so no filesystem path ever
 * crosses the wire inbound. Global paths follow each CLI's own lookup rules:
 * the provider instance's configured home directory when set, otherwise the
 * CLI's default (`~/.codex`, `~/.claude` honoring `CLAUDE_CONFIG_DIR`,
 * `~/.cursor`, `~/.grok`).
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";

import {
  AGENT_INSTRUCTION_FILE_MAX_BYTES,
  AgentInstructionsError,
  ProviderDriverKind,
  ProviderInstanceId,
  type AgentInstructionFile,
  type AgentInstructionsListInput,
  type AgentInstructionsListResult,
  type AgentInstructionsReadInput,
  type AgentInstructionsReadResult,
  type AgentInstructionsWriteInput,
  type AgentInstructionsWriteResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { expandHomePath } from "../pathExpansion.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";

const AGENTS_FILE_NAME = "AGENTS.md";

/**
 * Global-file conventions per built-in driver. `defaultDirectory` mirrors the
 * lookup the CLI itself performs when no custom home is configured, so the
 * settings UI edits the exact file the agent will load.
 */
const GLOBAL_CONVENTIONS: ReadonlyArray<{
  readonly driver: string;
  readonly title: string;
  readonly fileName: string;
  readonly description: string;
  readonly defaultDirectory: (environment: NodeJS.ProcessEnv) => string;
}> = [
  {
    driver: "codex",
    title: "Codex",
    fileName: AGENTS_FILE_NAME,
    description: "Loaded by Codex at the start of every session, in every project.",
    defaultDirectory: () => joinHome(".codex"),
  },
  {
    driver: "claudeAgent",
    title: "Claude Code",
    fileName: "CLAUDE.md",
    description: "Loaded by Claude Code at the start of every session, in every project.",
    defaultDirectory: (environment) => {
      // Matches resolveClaudeConfigDirPath in provider/Drivers/ClaudeSkills.ts:
      // an env-provided CLAUDE_CONFIG_DIR reaches the CLI verbatim.
      const environmentConfigDir = environment.CLAUDE_CONFIG_DIR?.trim() ?? "";
      return environmentConfigDir.length > 0 ? environmentConfigDir : joinHome(".claude");
    },
  },
  {
    driver: "cursor",
    title: "Cursor",
    fileName: AGENTS_FILE_NAME,
    description: "Loaded by the Cursor agent at the start of every session, in every project.",
    defaultDirectory: () => joinHome(".cursor"),
  },
  {
    driver: "grok",
    title: "Grok",
    fileName: AGENTS_FILE_NAME,
    description: "Loaded by Grok at the start of every session, in every project.",
    defaultDirectory: () => joinHome(".grok"),
  },
];

const PROJECT_CONVENTIONS: ReadonlyArray<{
  readonly fileName: string;
  readonly title: string;
  readonly description: string;
}> = [
  {
    fileName: AGENTS_FILE_NAME,
    title: "Shared rules",
    description: "The AGENTS.md standard, read by Codex, Cursor, and Grok.",
  },
  {
    fileName: "CLAUDE.md",
    title: "Claude Code",
    description: "Project instructions Claude Code loads for threads in this workspace.",
  },
  {
    fileName: "CLAUDE.local.md",
    title: "Claude Code · local",
    description: "Personal, typically gitignored instructions layered on top of CLAUDE.md.",
  },
];

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

type InstructionTarget = Omit<AgentInstructionFile, "exists" | "sizeBytes" | "modifiedAtMs">;

export class AgentInstructionFiles extends Context.Service<
  AgentInstructionFiles,
  {
    readonly list: (
      input: AgentInstructionsListInput,
    ) => Effect.Effect<AgentInstructionsListResult, AgentInstructionsError>;
    readonly read: (
      input: AgentInstructionsReadInput,
    ) => Effect.Effect<AgentInstructionsReadResult, AgentInstructionsError>;
    readonly write: (
      input: AgentInstructionsWriteInput,
    ) => Effect.Effect<AgentInstructionsWriteResult, AgentInstructionsError>;
  }
>()("t3/instructions/AgentInstructionFiles") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverSettings = yield* ServerSettingsService;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

  const abbreviateHome = (absolutePath: string): string => {
    const home = NodeOS.homedir();
    return absolutePath === home || absolutePath.startsWith(`${home}${path.sep}`)
      ? `~${absolutePath.slice(home.length)}`
      : absolutePath;
  };

  const globalTargets = Effect.fn("AgentInstructionFiles.globalTargets")(function* () {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) => new AgentInstructionsError({ failure: "operation_failed", cause }),
      ),
    );

    const targets: Array<InstructionTarget> = [];
    const seenPaths = new Set<string>();
    for (const convention of GLOBAL_CONVENTIONS) {
      const defaultDirectory = path.resolve(
        expandHomePath(convention.defaultDirectory(process.env)),
      );
      const defaultPath = path.join(defaultDirectory, convention.fileName);
      seenPaths.add(defaultPath);
      targets.push({
        id: `global:${convention.driver}`,
        scope: "global",
        fileName: convention.fileName,
        absolutePath: defaultPath,
        displayPath: abbreviateHome(defaultPath),
        driver: ProviderDriverKind.make(convention.driver),
        title: convention.title,
        description: convention.description,
      });

      // Instances with a custom home read their global file from that home
      // instead — surface those as separate rows. Instances without one
      // resolve to the default path and are covered by the row above.
      for (const [instanceId, instance] of Object.entries(settings.providerInstances)) {
        if (instance.driver !== convention.driver) {
          continue;
        }
        const homePath = configuredHomePath(instance.config);
        if (homePath.length === 0) {
          continue;
        }
        const instancePath = path.join(path.resolve(expandHomePath(homePath)), convention.fileName);
        if (seenPaths.has(instancePath)) {
          continue;
        }
        seenPaths.add(instancePath);
        targets.push({
          id: `global:${convention.driver}:${instanceId}`,
          scope: "global",
          fileName: convention.fileName,
          absolutePath: instancePath,
          displayPath: abbreviateHome(instancePath),
          driver: ProviderDriverKind.make(convention.driver),
          instanceId: ProviderInstanceId.make(instanceId),
          title: `${convention.title} · ${instance.displayName ?? instanceId}`,
          description: convention.description,
        });
      }
    }
    return targets;
  });

  const projectTargets = Effect.fn("AgentInstructionFiles.projectTargets")(function* (
    projectCwd: string,
  ) {
    if (!path.isAbsolute(projectCwd)) {
      return yield* Effect.fail(
        new AgentInstructionsError({ failure: "invalid_project_root", operationPath: projectCwd }),
      );
    }
    const info = yield* fileSystem.stat(projectCwd).pipe(Effect.orElseSucceed(() => undefined));
    if (info === undefined || info.type !== "Directory") {
      return yield* Effect.fail(
        new AgentInstructionsError({ failure: "invalid_project_root", operationPath: projectCwd }),
      );
    }
    return PROJECT_CONVENTIONS.map(
      (convention): InstructionTarget => ({
        id: `project:${convention.fileName}`,
        scope: "project",
        fileName: convention.fileName,
        absolutePath: path.join(projectCwd, convention.fileName),
        displayPath: abbreviateHome(path.join(projectCwd, convention.fileName)),
        title: convention.title,
        description: convention.description,
      }),
    );
  });

  const resolveTarget = Effect.fn("AgentInstructionFiles.resolveTarget")(function* (
    fileId: string,
    projectCwd: string | undefined,
  ) {
    const targets = fileId.startsWith("project:")
      ? projectCwd === undefined
        ? yield* Effect.fail(new AgentInstructionsError({ failure: "unknown_file", fileId }))
        : yield* projectTargets(projectCwd)
      : yield* globalTargets();
    const target = targets.find((candidate) => candidate.id === fileId);
    if (target === undefined) {
      return yield* Effect.fail(new AgentInstructionsError({ failure: "unknown_file", fileId }));
    }
    return target;
  });

  const describeTarget = Effect.fn("AgentInstructionFiles.describeTarget")(function* (
    target: InstructionTarget,
  ) {
    const info = yield* fileSystem
      .stat(target.absolutePath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (info === undefined || info.type !== "File") {
      return { ...target, exists: false } satisfies AgentInstructionFile;
    }
    const modifiedAt = Option.getOrUndefined(info.mtime);
    return {
      ...target,
      exists: true,
      sizeBytes: Number(info.size),
      ...(modifiedAt === undefined ? {} : { modifiedAtMs: modifiedAt.getTime() }),
    } satisfies AgentInstructionFile;
  });

  const list: AgentInstructionFiles["Service"]["list"] = Effect.fn("AgentInstructionFiles.list")(
    function* (input) {
      const targets = [
        ...(yield* globalTargets()),
        ...(input.projectCwd === undefined ? [] : yield* projectTargets(input.projectCwd)),
      ];
      const files = yield* Effect.forEach(targets, describeTarget, { concurrency: 8 });
      return { files };
    },
  );

  const read: AgentInstructionFiles["Service"]["read"] = Effect.fn("AgentInstructionFiles.read")(
    function* (input) {
      const target = yield* resolveTarget(input.fileId, input.projectCwd);
      const file = yield* describeTarget(target);
      if (!file.exists) {
        return { file, contents: "", truncated: false };
      }
      const info = yield* fileSystem.stat(target.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new AgentInstructionsError({
              failure: "operation_failed",
              fileId: input.fileId,
              operationPath: target.absolutePath,
              cause,
            }),
        ),
      );
      if (info.type !== "File") {
        return yield* Effect.fail(
          new AgentInstructionsError({
            failure: "path_not_file",
            fileId: input.fileId,
            operationPath: target.absolutePath,
          }),
        );
      }
      const contents = yield* fileSystem.readFileString(target.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new AgentInstructionsError({
              failure: "operation_failed",
              fileId: input.fileId,
              operationPath: target.absolutePath,
              cause,
            }),
        ),
      );
      if (contents.includes("\u0000")) {
        return yield* Effect.fail(
          new AgentInstructionsError({
            failure: "binary_file",
            fileId: input.fileId,
            operationPath: target.absolutePath,
          }),
        );
      }
      const truncated = contents.length > AGENT_INSTRUCTION_FILE_MAX_BYTES;
      return {
        file,
        contents: truncated ? contents.slice(0, AGENT_INSTRUCTION_FILE_MAX_BYTES) : contents,
        truncated,
      };
    },
  );

  const write: AgentInstructionFiles["Service"]["write"] = Effect.fn("AgentInstructionFiles.write")(
    function* (input) {
      const target = yield* resolveTarget(input.fileId, input.projectCwd);
      if (new TextEncoder().encode(input.contents).byteLength > AGENT_INSTRUCTION_FILE_MAX_BYTES) {
        return yield* Effect.fail(
          new AgentInstructionsError({
            failure: "too_large",
            fileId: input.fileId,
            operationPath: target.absolutePath,
          }),
        );
      }
      if (input.contents.includes("\u0000")) {
        return yield* Effect.fail(
          new AgentInstructionsError({
            failure: "binary_file",
            fileId: input.fileId,
            operationPath: target.absolutePath,
          }),
        );
      }
      yield* writeFileStringAtomically({
        filePath: target.absolutePath,
        contents: input.contents,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.mapError(
          (cause) =>
            new AgentInstructionsError({
              failure: "operation_failed",
              fileId: input.fileId,
              operationPath: target.absolutePath,
              cause,
            }),
        ),
      );
      if (target.scope === "project" && input.projectCwd !== undefined) {
        yield* workspaceEntries.refresh(input.projectCwd).pipe(Effect.ignore);
      }
      const file = yield* describeTarget(target);
      return { file };
    },
  );

  return AgentInstructionFiles.of({ list, read, write });
});

export const layer = Layer.effect(AgentInstructionFiles, make);
