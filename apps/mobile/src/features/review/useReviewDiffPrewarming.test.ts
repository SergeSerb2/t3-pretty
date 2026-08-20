import { describe, expect, it } from "vite-plus/test";

import {
  REVIEW_DIFF_PREWARM_MAX_CHARACTERS,
  REVIEW_DIFF_PREWARM_MAX_SECTIONS,
  selectReviewDiffPrewarmSections,
} from "./useReviewDiffPrewarming";
import type { ReviewSectionItem } from "./reviewModel";

function section(id: string, diff: string | null): ReviewSectionItem {
  return { id, kind: "turn", title: id, subtitle: null, diff, isLoading: false };
}

describe("selectReviewDiffPrewarmSections", () => {
  it("excludes the selected section and bounds count", () => {
    const sections = Array.from({ length: REVIEW_DIFF_PREWARM_MAX_SECTIONS + 2 }, (_, i) =>
      section(String(i), "diff"),
    );
    expect(selectReviewDiffPrewarmSections(sections, "0").map((item) => item.id)).toHaveLength(
      REVIEW_DIFF_PREWARM_MAX_SECTIONS,
    );
    expect(selectReviewDiffPrewarmSections(sections, "0").some((item) => item.id === "0")).toBe(
      false,
    );
  });

  it("skips oversized sections and stays within the character budget", () => {
    const sections = [
      section("oversized", "x".repeat(REVIEW_DIFF_PREWARM_MAX_CHARACTERS + 1)),
      section("first", "x".repeat(REVIEW_DIFF_PREWARM_MAX_CHARACTERS - 1)),
      section("over-budget", "xx"),
      section("last", "x"),
    ];
    const selected = selectReviewDiffPrewarmSections(sections, null);
    expect(selected.map((item) => item.id)).toEqual(["first", "last"]);
    expect(
      selected.reduce((total, item) => total + (item.diff?.length ?? 0), 0),
    ).toBeLessThanOrEqual(REVIEW_DIFF_PREWARM_MAX_CHARACTERS);
  });
});
