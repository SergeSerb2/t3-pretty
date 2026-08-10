/**
 * Agent instruction files — the markdown documents coding agents load as
 * standing guidance. Two scopes:
 *
 * - `global`: per provider, applied to every session that provider runs
 *   (e.g. `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`). Paths depend on the
 *   provider instance's configured home directory, so only the server can
 *   resolve them.
 * - `project`: files at a project's workspace root that steer the agent inside
 *   that project (`AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`).
 *
 * Clients never send filesystem paths. They address files by the stable `id`
 * the server minted in a `list` result, and the server re-resolves that id to
 * an absolute path on every read/write. Adding a client-supplied path here
 * would widen the arbitrary-write surface — don't.
 */
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const AGENT_INSTRUCTION_FILE_MAX_BYTES = 1024 * 1024;

export const AgentInstructionScope = Schema.Literals(["global", "project"]);
export type AgentInstructionScope = typeof AgentInstructionScope.Type;

/**
 * One instruction file the server knows how to locate. `exists` reflects the
 * stat at list/read time; missing files are still listed so the UI can offer
 * to create them.
 */
export const AgentInstructionFile = Schema.Struct({
  id: TrimmedNonEmptyString,
  scope: AgentInstructionScope,
  fileName: TrimmedNonEmptyString,
  absolutePath: TrimmedNonEmptyString,
  /** Human-oriented location, `~`-abbreviated (e.g. `~/.codex/AGENTS.md`). */
  displayPath: TrimmedNonEmptyString,
  driver: Schema.optional(ProviderDriverKind),
  instanceId: Schema.optional(ProviderInstanceId),
  /** Provider or file title for row headers (e.g. "Codex", "Shared rules"). */
  title: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  exists: Schema.Boolean,
  sizeBytes: Schema.optional(NonNegativeInt),
  modifiedAtMs: Schema.optional(NonNegativeInt),
});
export type AgentInstructionFile = typeof AgentInstructionFile.Type;

export const AgentInstructionsListInput = Schema.Struct({
  /**
   * Absolute workspace root to enumerate project-scope files for. Omitted →
   * global files only.
   */
  projectCwd: Schema.optional(TrimmedNonEmptyString),
});
export type AgentInstructionsListInput = typeof AgentInstructionsListInput.Type;

export const AgentInstructionsListResult = Schema.Struct({
  files: Schema.Array(AgentInstructionFile),
});
export type AgentInstructionsListResult = typeof AgentInstructionsListResult.Type;

export const AgentInstructionsReadInput = Schema.Struct({
  fileId: TrimmedNonEmptyString,
  projectCwd: Schema.optional(TrimmedNonEmptyString),
});
export type AgentInstructionsReadInput = typeof AgentInstructionsReadInput.Type;

export const AgentInstructionsReadResult = Schema.Struct({
  file: AgentInstructionFile,
  contents: Schema.String,
  truncated: Schema.Boolean,
});
export type AgentInstructionsReadResult = typeof AgentInstructionsReadResult.Type;

export const AgentInstructionsWriteInput = Schema.Struct({
  fileId: TrimmedNonEmptyString,
  projectCwd: Schema.optional(TrimmedNonEmptyString),
  contents: Schema.String,
});
export type AgentInstructionsWriteInput = typeof AgentInstructionsWriteInput.Type;

export const AgentInstructionsWriteResult = Schema.Struct({
  file: AgentInstructionFile,
});
export type AgentInstructionsWriteResult = typeof AgentInstructionsWriteResult.Type;

export const AgentInstructionsFailure = Schema.Literals([
  "unknown_file",
  "invalid_project_root",
  "path_not_file",
  "binary_file",
  "too_large",
  "operation_failed",
]);
export type AgentInstructionsFailure = typeof AgentInstructionsFailure.Type;

type AgentInstructionsFailureContext = {
  readonly failure: AgentInstructionsFailure;
  readonly fileId?: string;
  readonly operationPath?: string;
  readonly cause?: unknown;
};

const FAILURE_MESSAGES: Record<AgentInstructionsFailure, string> = {
  unknown_file: "Unknown agent instruction file.",
  invalid_project_root: "Project root is not an absolute path to an existing directory.",
  path_not_file: "Agent instruction path exists but is not a regular file.",
  binary_file: "Agent instruction file contains binary data.",
  too_large: "Agent instruction file exceeds the 1 MiB limit.",
  operation_failed: "Agent instruction file operation failed.",
};

export class AgentInstructionsError extends Schema.TaggedErrorClass<AgentInstructionsError>()(
  "AgentInstructionsError",
  {
    failure: Schema.optional(AgentInstructionsFailure),
    fileId: Schema.optional(TrimmedNonEmptyString),
    operationPath: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: AgentInstructionsFailureContext) {
    super({
      ...props,
      message: FAILURE_MESSAGES[props.failure],
    } as any);
  }
}
