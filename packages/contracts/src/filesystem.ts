import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
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

export class FilesystemBrowseError extends Schema.TaggedErrorClass<FilesystemBrowseError>()(
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
