import { describe, expect, it } from "vite-plus/test";

import {
  classifySkillLoadItemType,
  extractSkillMentions,
  skillMentionMatchesName,
  skillMentionToken,
  isSkillToolName,
  isSkillToolTitle,
  resolveSkillToolName,
  skillNameFromTitle,
  skillNameFromToolInput,
} from "./skillTool.ts";

describe("skillTool", () => {
  it("matches Skill loader tool names and rejects incidental substrings", () => {
    expect(isSkillToolName("Skill")).toBe(true);
    expect(isSkillToolName("skills")).toBe(true);
    expect(isSkillToolName("load_skill")).toBe(true);
    expect(isSkillToolName("Bash")).toBe(false);
    expect(isSkillToolName("skillissue")).toBe(false);
  });

  it("reads the skill name from known input keys only", () => {
    expect(skillNameFromToolInput({ skill: "grill-me" })).toBe("grill-me");
    expect(skillNameFromToolInput({ skillName: "tdd" })).toBe("tdd");
    expect(skillNameFromToolInput({ name: "not-a-skill" })).toBeUndefined();
  });

  it("parses Skill titles used by ACP adapters", () => {
    expect(isSkillToolTitle("Skill")).toBe(true);
    expect(skillNameFromTitle("Skill: grill-me")).toBe("grill-me");
    expect(skillNameFromTitle("Loaded skill · tdd")).toBe("tdd");
    expect(isSkillToolTitle("Read File")).toBe(false);
  });

  it("classifies skill_load from tool name, kind, or title", () => {
    expect(classifySkillLoadItemType({ toolName: "Skill" })).toBe("skill_load");
    expect(classifySkillLoadItemType({ kind: "skill" })).toBe("skill_load");
    expect(classifySkillLoadItemType({ title: "Skill: grill-me" })).toBe("skill_load");
    expect(classifySkillLoadItemType({ title: "Read File", kind: "read" })).toBeUndefined();
  });

  it("prefers structured input over a title suffix", () => {
    expect(
      resolveSkillToolName({
        title: "Skill: ignored",
        toolInput: { skill: "grill-me" },
      }),
    ).toBe("grill-me");
  });

  it("collects $skill mentions in first-seen order", () => {
    expect(extractSkillMentions("please $grill-me and $tdd then $grill-me again")).toEqual([
      "grill-me",
      "tdd",
    ]);
    expect(extractSkillMentions("$solo-skill")).toEqual(["solo-skill"]);
    expect(extractSkillMentions("price is $5 and email@host")).toEqual([]);
  });

  it("folds skill names outside the mention grammar into a mentionable token", () => {
    expect(skillMentionToken("grill-me")).toBe("grill-me");
    expect(skillMentionToken("plugin:review")).toBe("plugin:review");
    expect(skillMentionToken("next.js-upgrade")).toBe("next-js-upgrade");
    expect(skillMentionToken("PDF Processing")).toBe("pdf-processing");
    expect(extractSkillMentions(`$${skillMentionToken("next.js-upgrade")} please`)).toEqual([
      "next-js-upgrade",
    ]);
    expect(skillMentionMatchesName("next-js-upgrade", "next.js-upgrade")).toBe(true);
    expect(skillMentionMatchesName("next.js-upgrade", "next.js-upgrade")).toBe(true);
    expect(skillMentionMatchesName("next-js", "next.js-upgrade")).toBe(false);
  });
});
