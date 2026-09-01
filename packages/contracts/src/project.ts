import * as Schema from "effect/Schema";
import {
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { ProjectFaviconPath } from "./orchestration.ts";

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

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
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

export class ProjectSearchContentsError extends Schema.TaggedErrorClass<ProjectSearchContentsError>()(
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

export class ProjectListEntriesError extends Schema.TaggedErrorClass<ProjectListEntriesError>()(
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

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
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

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
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

export class ProjectImportFaviconError extends Schema.TaggedErrorClass<ProjectImportFaviconError>()(
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
