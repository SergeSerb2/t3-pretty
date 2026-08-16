import { describe, expect, it } from "@effect/vitest";

import { renderSkillsPrelude } from "./SkillPrelude.ts";

const tdd = { name: "tdd", directory: "/repo/.claude/skills/tdd", body: "Red, green, refactor." };
const grill = {
  name: "grill-me",
  directory: "/home/u/.claude/skills/grill-me",
  body: "Ask one question at a time.",
};

describe("renderSkillsPrelude", () => {
  it("wraps each skill body in a block with its name and directory", () => {
    const rendered = renderSkillsPrelude({ skills: [tdd, grill], maxChars: 10_000 });
    expect(rendered?.included).toEqual([tdd, grill]);
    expect(rendered?.omitted).toEqual([]);
    expect(rendered?.text).toBe(
      [
        "[Skills]",
        "The skills below are attached to this conversation. Their full instructions are included here, so they are already loaded: apply them where they are relevant, and do not call a Skill tool to load them again. Relative paths inside a skill resolve against that skill's directory.",
        "",
        '<skill name="tdd" directory="/repo/.claude/skills/tdd">',
        "Red, green, refactor.",
        "</skill>",
        "",
        '<skill name="grill-me" directory="/home/u/.claude/skills/grill-me">',
        "Ask one question at a time.",
        "</skill>",
        "",
        "[End skills]",
      ].join("\n"),
    );
  });

  it("drops whole skills that do not fit instead of truncating them", () => {
    const small = renderSkillsPrelude({ skills: [tdd, grill], maxChars: 10_000 });
    const budget = small!.text.length - 1;
    const rendered = renderSkillsPrelude({ skills: [tdd, grill], maxChars: budget });
    expect(rendered?.included).toEqual([tdd]);
    expect(rendered?.omitted).toEqual([grill]);
    expect(rendered?.text.length).toBeLessThanOrEqual(budget);
    expect(rendered?.text).not.toContain("grill-me");
  });

  it("returns undefined when nothing fits", () => {
    expect(renderSkillsPrelude({ skills: [tdd], maxChars: 10 })).toBeUndefined();
    expect(renderSkillsPrelude({ skills: [], maxChars: 10_000 })).toBeUndefined();
  });
});
