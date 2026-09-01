import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  REVIEW_DIFF_FILE_CONTENTS_MAX_CHARS,
  REVIEW_DIFF_PREVIEW_MAX_CHARS,
  REVIEW_DIFF_PREVIEW_MAX_SOURCES,
  ReviewDiffFileContentsResult,
  ReviewDiffPreviewResult,
} from "./review.ts";

const source = {
  id: "working-tree",
  kind: "working-tree" as const,
  title: "Dirty worktree",
  baseRef: "HEAD",
  headRef: null,
  diff: "",
  diffHash: "hash",
  truncated: false,
};

it("rejects review previews with an oversized patch", () => {
  const decode = Schema.decodeUnknownSync(ReviewDiffPreviewResult);
  expect(() =>
    decode({
      cwd: "/repo",
      generatedAt: DateTime.nowUnsafe(),
      sources: [{ ...source, diff: "x".repeat(REVIEW_DIFF_PREVIEW_MAX_CHARS + 1) }],
    }),
  ).toThrow();
});

it("rejects review previews with too many sources", () => {
  const decode = Schema.decodeUnknownSync(ReviewDiffPreviewResult);
  expect(() =>
    decode({
      cwd: "/repo",
      generatedAt: DateTime.nowUnsafe(),
      sources: Array.from({ length: REVIEW_DIFF_PREVIEW_MAX_SOURCES + 1 }, () => source),
    }),
  ).toThrow();
});

it("rejects expanded review files above the producer byte budget", () => {
  const decode = Schema.decodeUnknownSync(ReviewDiffFileContentsResult);
  expect(() =>
    decode({
      oldContents: "x".repeat(REVIEW_DIFF_FILE_CONTENTS_MAX_CHARS + 1),
      newContents: "",
    }),
  ).toThrow();
});
