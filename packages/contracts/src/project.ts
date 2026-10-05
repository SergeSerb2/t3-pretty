import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { RepositoryIdentity, ThreadEnvMode } from "./environment.ts";
import { ModelSelection } from "./modelSelection.ts";
import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";




export const PROJECT_SCRIPT_MAX_COUNT = 256;
export const PROJECT_SCRIPT_ID_MAX_LENGTH = 512;
export const PROJECT_SCRIPT_NAME_MAX_LENGTH = 512;
export const PROJECT_SCRIPT_COMMAND_MAX_LENGTH = 64 * 1024;
export const PROJECT_SCRIPT_PREVIEW_URL_MAX_LENGTH = 8_192;

export const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
export const PROJECT_SEARCH_CONTENTS_MAX_LIMIT = 500;
export const PROJECT_PATH_MAX_LENGTH = 32 * 1024;
export const PROJECT_SEARCH_CONTENT_LINE_MAX_LENGTH = 64 * 1024;
export const PROJECT_SEARCH_CONTENT_MATCH_RANGES_MAX = 100;
export const PROJECT_SEARCH_CONTENT_TOTAL_LINE_CHARS_MAX = 8 * 1024 * 1024;
export const PROJECT_SEARCH_CONTENT_TOTAL_PATH_CHARS_MAX = 2 * 1024 * 1024;
export const PROJECT_SEARCH_CONTENT_TOTAL_MATCH_RANGES_MAX = 50_000;
export const PROJECT_SEARCH_CONTENT_REGEX_ERROR_MAX_LENGTH = 8_192;
export const PROJECT_LIST_ENTRIES_MAX = 25_000;
export const PROJECT_LIST_ENTRIES_TOTAL_PATH_CHARS_MAX = 16 * 1024 * 1024;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_READ_FILE_PATH_MAX_LENGTH = 512;
export const PROJECT_FILE_CONTENTS_MAX_BYTES = 1024 * 1024;
export const PROJECT_FILE_CONTENTS_MAX_LENGTH = PROJECT_FILE_CONTENTS_MAX_BYTES;

const ProjectPath = TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_PATH_MAX_LENGTH));

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
  /** Start the agent while setup runs unless explicitly disabled. */
  async: Schema.optional(Schema.Boolean),
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  autoOpenPreview: Schema.optional(Schema.Boolean),
});
export type ProjectScript = typeof ProjectScript.Type;

export const ProjectIconColor = Schema.Literals([
  "gray",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
]);
export type ProjectIconColor = typeof ProjectIconColor.Type;

const ProjectLucideIconName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
);

const ProjectEmoji = TrimmedNonEmptyString.check(Schema.isMaxLength(32));

// Grapheme-count validation belongs to the server command boundary, not snapshot decoding.
export const ProjectMonogramText = TrimmedNonEmptyString.check(
  Schema.isMaxLength(32),
  Schema.isPattern(/^[\p{L}\p{N}][\p{L}\p{N}\p{M}\u200c\u200d]*$/u),
);

const ProjectLucideIcon = Schema.Struct({
  kind: Schema.Literal("lucide"),
  name: ProjectLucideIconName,
  color: ProjectIconColor,
});
const ProjectEmojiIcon = Schema.Struct({
  kind: Schema.Literal("emoji"),
  emoji: ProjectEmoji,
});
const ProjectMonogramIcon = Schema.Struct({
  kind: Schema.Literal("monogram"),
  text: ProjectMonogramText,
  color: ProjectIconColor,
});
const ProjectIcon = Schema.Union([ProjectLucideIcon, ProjectEmojiIcon, ProjectMonogramIcon]);
const ProjectLucideIconWire = Schema.Struct({
  ...ProjectLucideIcon.fields,
  monogramText: Schema.optional(ProjectMonogramText),
  monogram: Schema.optional(ProjectMonogramText),
});

/** A workspace-relative image a project may use as its favicon. */
export const ProjectFaviconPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(1024),
  Schema.isPattern(/\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i),
);
export type ProjectFaviconPath = typeof ProjectFaviconPath.Type;

// Older peers only know lucide/emoji. Keep monograms out of their validated
// `monogram` field too: old grapheme counters can reject otherwise valid text.
export const ProjectIconOverride = Schema.Union([
  ProjectLucideIconWire,
  ProjectEmojiIcon,
  ProjectMonogramIcon,
]).pipe(
  Schema.decodeTo(
    ProjectIcon,
    SchemaTransformation.transform({
      decode: (icon): typeof ProjectIcon.Type => {
        if (icon.kind !== "lucide") return icon;
        const text = icon.monogramText ?? icon.monogram;
        return text === undefined
          ? { kind: "lucide", name: icon.name, color: icon.color }
          : { kind: "monogram", text, color: icon.color };
      },
      encode: (icon) =>
        icon.kind === "monogram"
          ? {
              kind: "lucide" as const,
              name: "folder-code",
              color: icon.color,
              monogramText: icon.text,
            }
          : icon,
    }),
  ),
);
export type ProjectIconOverride = typeof ProjectIconOverride.Type;

export const Project = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  faviconPath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  projectIcon: Schema.optional(Schema.NullOr(ProjectIconOverride)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  // Opt-in because background sync performs network I/O and may move the checkout.
  autoPull: Schema.optional(Schema.Boolean),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type Project = typeof Project.Type;

export const ProjectSnapshot = Schema.Struct({
  projects: Schema.Array(Project),
  updatedAt: IsoDateTime,
});
export type ProjectSnapshot = typeof ProjectSnapshot.Type;

export const ProjectChange = Schema.Union([
  Schema.Struct({ type: Schema.Literal("project.upserted"), project: Project }),
  Schema.Struct({
    type: Schema.Literal("project.deleted"),
    projectId: ProjectId,
    deletedAt: IsoDateTime,
  }),
]);
export type ProjectChange = typeof ProjectChange.Type;

export const ProjectCreatePayload = Schema.Struct({
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
});
export type ProjectCreatePayload = typeof ProjectCreatePayload.Type;

export const ProjectUpdatePayload = Schema.Struct({
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  autoPull: Schema.optional(Schema.Boolean),
  projectIcon: Schema.optional(Schema.NullOr(ProjectIconOverride)),
  faviconPath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
});
export type ProjectUpdatePayload = typeof ProjectUpdatePayload.Type;

export const ProjectMutation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("project.create"),
    commandId: CommandId,
    projectId: ProjectId,
    ...ProjectCreatePayload.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("project.update"),
    commandId: CommandId,
    projectId: ProjectId,
    ...ProjectUpdatePayload.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("project.delete"),
    commandId: CommandId,
    projectId: ProjectId,
    force: Schema.optional(Schema.Boolean),
  }),
]);
export type ProjectMutation = typeof ProjectMutation.Type;

export class ProjectMutationError extends Schema.TaggedError<ProjectMutationError>()(
  "ProjectMutationError",
  {
    commandId: CommandId,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const ProjectEntryKind = Schema.Literals(["file", "directory"]);
export type ProjectEntryKind = typeof ProjectEntryKind.Type;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: ProjectPath,
  // An empty query is a bounded browse: the index returns frecency-ordered
  // entries, which the file picker uses for its initial results.
  query: TrimmedString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
  kind: Schema.optional(ProjectEntryKind),
  imageOnly: Schema.optional(Schema.Boolean),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

export const ProjectEntry = Schema.Struct({
  path: ProjectPath,
  kind: ProjectEntryKind,
  ignored: Schema.optional(Schema.Boolean),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry).check(Schema.isMaxLength(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectSearchContentsInput = Schema.Struct({
  cwd: ProjectPath,
  // Whitespace is significant in content queries (" foo", regex trailing
  // spaces), so the query is deliberately not trimmed on the wire.
  query: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_CONTENTS_MAX_LIMIT)),
  caseSensitive: Schema.Boolean,
  wholeWord: Schema.Boolean,
  useRegex: Schema.Boolean,
});
export type ProjectSearchContentsInput = typeof ProjectSearchContentsInput.Type;

export const ProjectContentMatchRange = Schema.Struct({
  start: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_CONTENT_LINE_MAX_LENGTH)),
  end: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_CONTENT_LINE_MAX_LENGTH)),
}).check(
  Schema.makeFilter((range) => range.start <= range.end || "match range must not be reversed"),
);
export type ProjectContentMatchRange = typeof ProjectContentMatchRange.Type;

export const ProjectContentMatch = Schema.Struct({
  path: ProjectPath,
  lineNumber: PositiveInt,
  lineContent: Schema.String.check(Schema.isMaxLength(PROJECT_SEARCH_CONTENT_LINE_MAX_LENGTH)),
  matchRanges: Schema.Array(ProjectContentMatchRange).check(
    Schema.isMaxLength(PROJECT_SEARCH_CONTENT_MATCH_RANGES_MAX),
  ),
});
export type ProjectContentMatch = typeof ProjectContentMatch.Type;

export const ProjectSearchContentsResult = Schema.Struct({
  matches: Schema.Array(ProjectContentMatch).check(
    Schema.isMaxLength(PROJECT_SEARCH_CONTENTS_MAX_LIMIT),
  ),
  truncated: Schema.Boolean,
  regexFallbackError: Schema.optional(
    Schema.String.check(Schema.isMaxLength(PROJECT_SEARCH_CONTENT_REGEX_ERROR_MAX_LENGTH)),
  ),
}).check(
  Schema.makeFilter((result) => {
    let totalLineCharacters = 0;
    let totalPathCharacters = 0;
    let totalMatchRanges = 0;
    for (const match of result.matches) {
      totalLineCharacters += match.lineContent.length;
      totalPathCharacters += match.path.length;
      totalMatchRanges += match.matchRanges.length;
      if (
        totalLineCharacters > PROJECT_SEARCH_CONTENT_TOTAL_LINE_CHARS_MAX ||
        totalPathCharacters > PROJECT_SEARCH_CONTENT_TOTAL_PATH_CHARS_MAX ||
        totalMatchRanges > PROJECT_SEARCH_CONTENT_TOTAL_MATCH_RANGES_MAX
      ) {
        return "content search result exceeds its aggregate wire budget";
      }
    }
    return true;
  }),
);
export type ProjectSearchContentsResult = typeof ProjectSearchContentsResult.Type;

export const ProjectListEntriesInput = Schema.Struct({
  cwd: ProjectPath,
  // Present for immediate filesystem children, including ignored entries; empty means root.
  // Omitted preserves the indexed recursive listing used by older clients.
  directoryPath: Schema.optional(TrimmedString),
});
export type ProjectListEntriesInput = typeof ProjectListEntriesInput.Type;

export const ProjectListEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry).check(Schema.isMaxLength(PROJECT_LIST_ENTRIES_MAX)),
  truncated: Schema.Boolean,
}).check(
  Schema.makeFilter((result) => {
    let totalPathCharacters = 0;
    for (const entry of result.entries) {
      totalPathCharacters += entry.path.length;
      if (totalPathCharacters > PROJECT_LIST_ENTRIES_TOTAL_PATH_CHARS_MAX) {
        return "project listing exceeds its aggregate path budget";
      }
    }
    return true;
  }),
);
export type ProjectListEntriesResult = typeof ProjectListEntriesResult.Type;

export const ProjectEntriesFailure = Schema.Literals([
  "workspace_root_not_found",
  "workspace_root_create_failed",
  "workspace_root_stat_failed",
  "workspace_root_not_directory",
  "search_index_create_failed",
  "search_index_scan_timed_out",
  "search_index_search_failed",
  "directory_list_failed",
]);
export type ProjectEntriesFailure = typeof ProjectEntriesFailure.Type;

type ProjectEntriesFailureContext = {
  readonly failure: ProjectEntriesFailure;
  readonly normalizedCwd?: string;
  readonly timeout?: string;
  readonly detail?: string;
  readonly cause?: unknown;
};

function decodedProjectErrorMessage(props: object): string | undefined {
  if (!("message" in props)) return undefined;
  return typeof props.message === "string" ? props.message : undefined;
}

export class ProjectSearchEntriesError extends Schema.TaggedError<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    queryLength: Schema.optional(NonNegativeInt),
    limit: Schema.optional(PositiveInt),
    failure: Schema.optional(ProjectEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // The structured fields are optional on the wire so newer peers can decode legacy message-only
  // failures. New application code must provide them through this constructor.
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(
    props: ProjectEntriesFailureContext & {
      readonly cwd: string;
      readonly queryLength: number;
      readonly limit: number;
    },
  ) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to search workspace entries in '${props.cwd}'.`,
    } as any);
  }
}

export class ProjectSearchContentsError extends Schema.TaggedError<ProjectSearchContentsError>()(
  "ProjectSearchContentsError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    queryLength: Schema.optional(NonNegativeInt),
    limit: Schema.optional(PositiveInt),
    failure: Schema.optional(ProjectEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(
    props: ProjectEntriesFailureContext & {
      readonly cwd: string;
      readonly queryLength: number;
      readonly limit: number;
    },
  ) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to search workspace contents in '${props.cwd}'.`,
    } as any);
  }
}

export class ProjectListEntriesError extends Schema.TaggedError<ProjectListEntriesError>()(
  "ProjectListEntriesError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(ProjectEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: ProjectEntriesFailureContext & { readonly cwd: string }) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ?? `Failed to list workspace entries in '${props.cwd}'.`,
    } as any);
  }
}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  // Workspace-relative, or an absolute host path for a file outside the
  // workspace. Only workspace-relative paths can be written back.
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  contents: Schema.String.check(Schema.isMaxLength(PROJECT_FILE_CONTENTS_MAX_LENGTH)),
  byteLength: NonNegativeInt,
  truncated: Schema.Boolean,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export const ProjectFileFailure = Schema.Literals([
  "workspace_path_outside_root",
  "resolved_path_outside_root",
  "path_not_file",
  "binary_file",
  "too_large",
  "operation_failed",
]);
export type ProjectFileFailure = typeof ProjectFileFailure.Type;

export const ProjectFileOperation = Schema.Literals([
  "realpath-workspace-root",
  "realpath-target",
  "open",
  "stat",
  "read",
  "close",
  "make-directory",
  "write-file",
]);
export type ProjectFileOperation = typeof ProjectFileOperation.Type;

type ProjectFileFailureContext = {
  readonly cwd: string;
  readonly relativePath: string;
  readonly failure: ProjectFileFailure;
  readonly resolvedPath?: string;
  readonly resolvedWorkspaceRoot?: string;
  readonly operation?: ProjectFileOperation;
  readonly operationPath?: string;
  readonly cause?: unknown;
};

export class ProjectReadFileError extends Schema.TaggedError<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    relativePath: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(ProjectFileFailure),
    resolvedPath: Schema.optional(TrimmedNonEmptyString),
    resolvedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
    operation: Schema.optional(ProjectFileOperation),
    operationPath: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: ProjectFileFailureContext) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to read workspace file '${props.relativePath}' in '${props.cwd}'.`,
    } as any);
  }
}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String.check(Schema.isMaxLength(PROJECT_FILE_CONTENTS_MAX_LENGTH)),
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

/** The environment's Scratch project, created on first request. */
export const ProjectEnsureScratchResult = Schema.Struct({
  projectId: ProjectId,
});
export type ProjectEnsureScratchResult = typeof ProjectEnsureScratchResult.Type;

/** A project started from just a name, in a new folder the server makes. */
export const ProjectCreateNewInput = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
});
export type ProjectCreateNewInput = typeof ProjectCreateNewInput.Type;

export const ProjectCreateNewResult = Schema.Struct({
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  /** Why the first commit failed. The project and its files exist either way. */
  commitError: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ProjectCreateNewResult = typeof ProjectCreateNewResult.Type;

export class ProjectWriteFileError extends Schema.TaggedError<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    relativePath: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(ProjectFileFailure),
    resolvedPath: Schema.optional(TrimmedNonEmptyString),
    resolvedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
    operation: Schema.optional(ProjectFileOperation),
    operationPath: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: ProjectFileFailureContext) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to write workspace file '${props.relativePath}' in '${props.cwd}'.`,
    } as any);
  }
}

export const PROJECT_IMPORT_FAVICON_MAX_BYTES = 2 * 1024 * 1024;
const PROJECT_IMPORT_FAVICON_MAX_DATA_URL_CHARS = 3_000_000;
const PROJECT_IMPORT_FAVICON_FILE_NAME_MAX_LENGTH = 255;

export const ProjectImportFaviconInput = Schema.Struct({
  projectId: ProjectId,
  fileName: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_IMPORT_FAVICON_FILE_NAME_MAX_LENGTH),
  ),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_IMPORT_FAVICON_MAX_DATA_URL_CHARS),
  ),
});
export type ProjectImportFaviconInput = typeof ProjectImportFaviconInput.Type;

export const ProjectImportFaviconResult = Schema.Struct({
  faviconPath: ProjectFaviconPath,
});
export type ProjectImportFaviconResult = typeof ProjectImportFaviconResult.Type;

export const ProjectImportFaviconFailure = Schema.Literals([
  "project_not_found",
  "invalid_image",
  "empty_or_too_large",
  "write_failed",
]);
export type ProjectImportFaviconFailure = typeof ProjectImportFaviconFailure.Type;

const PROJECT_IMPORT_FAVICON_FAILURE_MESSAGES: Record<ProjectImportFaviconFailure, string> = {
  project_not_found: "Project was not found.",
  invalid_image: "Choose an SVG, PNG, ICO, JPEG, GIF, AVIF, or WebP file.",
  empty_or_too_large: "Image is empty or larger than 2 MB.",
  write_failed: "Failed to save the project icon.",
};

export class ProjectImportFaviconError extends Schema.TaggedError<ProjectImportFaviconError>()(
  "ProjectImportFaviconError",
  {
    failure: Schema.optional(ProjectImportFaviconFailure),
    projectId: Schema.optional(ProjectId),
    fileName: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly failure: ProjectImportFaviconFailure;
    readonly projectId?: string;
    readonly fileName?: string;
    readonly cause?: unknown;
  }) {
    super({
      ...props,
      message: PROJECT_IMPORT_FAVICON_FAILURE_MESSAGES[props.failure],
    } as any);
  }
}
