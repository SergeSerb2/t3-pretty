import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VCS_PATH_MAX_LENGTH, VcsError } from "./vcs.ts";

export const REVIEW_DIFF_REFERENCE_MAX_LENGTH = 4_096;
export const REVIEW_DIFF_SOURCE_ID_MAX_LENGTH = 128;
export const REVIEW_DIFF_SOURCE_TITLE_MAX_LENGTH = 4_096;
export const REVIEW_DIFF_HASH_MAX_LENGTH = 128;
export const REVIEW_DIFF_PREVIEW_MAX_SOURCES = 2;
export const REVIEW_DIFF_PREVIEW_MAX_CHARS = 256 * 1_024;
export const REVIEW_DIFF_FILE_CONTENTS_MAX_CHARS = 1_024 * 1_024;

const ReviewPath = TrimmedNonEmptyString.check(Schema.isMaxLength(VCS_PATH_MAX_LENGTH));
const ReviewReference = TrimmedNonEmptyString.check(
  Schema.isMaxLength(REVIEW_DIFF_REFERENCE_MAX_LENGTH),
);

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: ReviewPath,
  baseRef: Schema.optional(ReviewReference),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals(["working-tree", "branch-range"]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(REVIEW_DIFF_SOURCE_ID_MAX_LENGTH)),
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(REVIEW_DIFF_SOURCE_TITLE_MAX_LENGTH)),
  baseRef: Schema.NullOr(ReviewReference),
  headRef: Schema.NullOr(ReviewReference),
  diff: Schema.String.check(Schema.isMaxLength(REVIEW_DIFF_PREVIEW_MAX_CHARS)),
  diffHash: TrimmedNonEmptyString.check(Schema.isMaxLength(REVIEW_DIFF_HASH_MAX_LENGTH)),
  truncated: Schema.Boolean,
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewDiffFileContentsInput = Schema.Struct({
  cwd: ReviewPath,
  sourceKind: ReviewDiffPreviewSourceKind,
  changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  baseRef: Schema.NullOr(ReviewReference),
  headRef: Schema.NullOr(ReviewReference),
  oldPath: ReviewPath,
  newPath: ReviewPath,
});
export type ReviewDiffFileContentsInput = typeof ReviewDiffFileContentsInput.Type;

export const ReviewDiffFileContentsResult = Schema.Struct({
  oldContents: Schema.String.check(Schema.isMaxLength(REVIEW_DIFF_FILE_CONTENTS_MAX_CHARS)),
  newContents: Schema.String.check(Schema.isMaxLength(REVIEW_DIFF_FILE_CONTENTS_MAX_CHARS)),
});
export type ReviewDiffFileContentsResult = typeof ReviewDiffFileContentsResult.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: ReviewPath,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource).check(
    Schema.isMaxLength(REVIEW_DIFF_PREVIEW_MAX_SOURCES),
  ),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;
