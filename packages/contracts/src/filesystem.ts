import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PROJECT_PATH_MAX_LENGTH } from "./project.ts";

export const FILESYSTEM_BROWSE_INPUT_PATH_MAX_LENGTH = PROJECT_PATH_MAX_LENGTH;
export const FILESYSTEM_PATH_MAX_LENGTH = PROJECT_PATH_MAX_LENGTH;
export const FILESYSTEM_ENTRY_NAME_MAX_LENGTH = 512;
export const FILESYSTEM_BROWSE_MAX_ENTRIES = 200;
export const FILESYSTEM_PLATFORM_MAX_LENGTH = 128;
export const FILESYSTEM_ERROR_MESSAGE_MAX_LENGTH = 2_048;

const FilesystemPath = TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH));
const FilesystemBrowseInputPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(FILESYSTEM_BROWSE_INPUT_PATH_MAX_LENGTH),
);
const FilesystemEntryName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(FILESYSTEM_ENTRY_NAME_MAX_LENGTH),
);

export const FILESYSTEM_METADATA_BATCH_LIMIT = 64;

export const FilesystemGetMetadataInput = Schema.Struct({
  // Absolute host paths, including ~/ paths. Relative paths need a workspace
  // anchor on the client; the server never resolves them against its own cwd.
  paths: Schema.Array(
    TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(FILESYSTEM_METADATA_BATCH_LIMIT)),
});
export type FilesystemGetMetadataInput = typeof FilesystemGetMetadataInput.Type;

export const FilesystemEntryMetadata = Schema.Struct({
  kind: Schema.Literals(["file", "directory", "other"]),
  byteLength: Schema.optionalKey(NonNegativeInt),
  mimeType: Schema.optionalKey(TrimmedNonEmptyString),
});
export type FilesystemEntryMetadata = typeof FilesystemEntryMetadata.Type;

// Results follow request order so paths do not have to travel back over the wire.
// A null entry means the path is missing, unreadable, or unsupported.
export const FilesystemGetMetadataResult = Schema.Struct({
  entries: Schema.Array(Schema.NullOr(FilesystemEntryMetadata)),
});
export type FilesystemGetMetadataResult = typeof FilesystemGetMetadataResult.Type;

export const FilesystemBrowseInput = Schema.Struct({
  partialPath: FilesystemBrowseInputPath,
  cwd: Schema.optional(FilesystemBrowseInputPath),
});
export type FilesystemBrowseInput = typeof FilesystemBrowseInput.Type;

export const FilesystemBrowseEntry = Schema.Struct({
  name: FilesystemEntryName,
  fullPath: FilesystemPath,
});
export type FilesystemBrowseEntry = typeof FilesystemBrowseEntry.Type;

export const FilesystemBrowseResult = Schema.Struct({
  parentPath: FilesystemPath,
  entries: Schema.Array(FilesystemBrowseEntry).check(
    Schema.isMaxLength(FILESYSTEM_BROWSE_MAX_ENTRIES),
  ),
  truncated: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type FilesystemBrowseResult = typeof FilesystemBrowseResult.Type;

export const FilesystemBrowseFailure = Schema.Literals([
  "windows_path_unsupported",
  "current_project_required",
  "read_directory_failed",
]);
export type FilesystemBrowseFailure = typeof FilesystemBrowseFailure.Type;

function decodedFilesystemBrowseErrorMessage(props: object): string | undefined {
  if (!("message" in props)) return undefined;
  return typeof props.message === "string" ? props.message : undefined;
}

export class FilesystemBrowseError extends Schema.TaggedError<FilesystemBrowseError>()(
  "FilesystemBrowseError",
  {
    partialPath: Schema.optional(FilesystemBrowseInputPath),
    cwd: Schema.optional(FilesystemBrowseInputPath),
    failure: Schema.optional(FilesystemBrowseFailure),
    parentPath: Schema.optional(FilesystemPath),
    platform: Schema.optional(
      TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PLATFORM_MAX_LENGTH)),
    ),
    message: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_ERROR_MESSAGE_MAX_LENGTH)),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // Structured diagnostics stay optional for rolling compatibility with legacy message-only
  // payloads, while new call sites must provide the request context and failure classification.
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly partialPath: string;
    readonly cwd?: string | undefined;
    readonly failure: FilesystemBrowseFailure;
    readonly parentPath?: string;
    readonly platform?: string;
    readonly cause?: unknown;
  }) {
    const partialPath =
      typeof props.partialPath === "string"
        ? props.partialPath.trim().slice(0, FILESYSTEM_BROWSE_INPUT_PATH_MAX_LENGTH) || "."
        : undefined;
    const boundedCwd = props.cwd?.trim().slice(0, FILESYSTEM_BROWSE_INPUT_PATH_MAX_LENGTH);
    const cwd = boundedCwd ? ` from '${boundedCwd}'` : "";
    const decodedMessage = decodedFilesystemBrowseErrorMessage(props)
      ?.trim()
      .slice(0, FILESYSTEM_ERROR_MESSAGE_MAX_LENGTH);
    const generatedMessage = partialPath
      ? `Failed to browse filesystem path '${partialPath}'${cwd}.`
      : "Failed to browse filesystem path.";
    super({
      ...(partialPath ? { partialPath } : {}),
      ...(boundedCwd ? { cwd: boundedCwd } : {}),
      ...(props.failure === undefined ? {} : { failure: props.failure }),
      ...(props.parentPath === undefined
        ? {}
        : { parentPath: props.parentPath.trim().slice(0, FILESYSTEM_PATH_MAX_LENGTH) || "." }),
      ...(props.platform === undefined
        ? {}
        : {
            platform: props.platform.trim().slice(0, FILESYSTEM_PLATFORM_MAX_LENGTH) || "unknown",
          }),
      ...(props.cause === undefined ? {} : { cause: props.cause }),
      message: decodedMessage || generatedMessage.slice(0, FILESYSTEM_ERROR_MESSAGE_MAX_LENGTH),
    } as any);
  }
}
