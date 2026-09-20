import { describe, expect, it } from "vite-plus/test";

import { parseSkillFrontmatter } from "./skillFrontmatter.ts";

describe("parseSkillFrontmatter", () => {
  it("recognizes frontmatter after a UTF-8 byte-order mark", () => {
    expect(
      parseSkillFrontmatter("\uFEFF---\nname: review\ndescription: Review changes.\n---\nBody"),
    ).toEqual({
      kind: "parsed",
      name: "review",
      description: "Review changes.",
    });
  });
});
