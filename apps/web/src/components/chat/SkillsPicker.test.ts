import { describe, expect, it } from "vite-plus/test";
import type { Skill } from "@t3tools/contracts";

import {
  normalizePickedSkillIds,
  organizePickerSkills,
  skillMatchesQuery,
  toPickerSkills,
} from "./SkillsPicker";

const skill = (overrides: Partial<Skill> & Pick<Skill, "id" | "name">): Skill => ({
  dirName: overrides.name,
  displayPath: `~/.agents/skills/${overrides.name}`,
  home: "agents",
  presentIn: ["agents"],
  ...overrides,
});

const inventory: Skill[] = [
  skill({ id: "host:agents:tdd", name: "tdd", description: "Write the test first" }),
  skill({
    id: "host:claudeAgent:grill-me",
    name: "grill-me",
    displayPath: "~/.claude/skills/grill-me",
    home: "claudeAgent",
    presentIn: ["claudeAgent"],
  }),
  skill({ id: "host:agents:ponytail", name: "ponytail", description: "Be lazy" }),
];

describe("toPickerSkills", () => {
  it("keeps the id and name and falls back to the folder when there is no description", () => {
    expect(toPickerSkills(inventory)).toEqual([
      { id: "host:agents:tdd", name: "tdd", description: "Write the test first" },
      {
        id: "host:claudeAgent:grill-me",
        name: "grill-me",
        description: "~/.claude/skills/grill-me",
      },
      { id: "host:agents:ponytail", name: "ponytail", description: "Be lazy" },
    ]);
  });
});

describe("normalizePickedSkillIds", () => {
  it("folds pre-library ids onto their library form", () => {
    expect(normalizePickedSkillIds(["mattpocock/skills:skills/productivity/grill-me"])).toEqual([
      "host:agents:grill-me",
    ]);
  });

  it("passes library ids through and drops duplicates folding creates", () => {
    expect(
      normalizePickedSkillIds([
        "host:agents:grill-me",
        "mattpocock/skills:skills/productivity/grill-me",
        "host:agents:tdd",
        "host:agents:tdd",
      ]),
    ).toEqual(["host:agents:grill-me", "host:agents:tdd"]);
  });
});

describe("organizePickerSkills", () => {
  const skills = toPickerSkills(inventory);

  it("pins favorites first and keeps the rest in list order", () => {
    const { favorites, rest } = organizePickerSkills(skills, new Set(["host:agents:ponytail"]));
    expect(favorites.map((row) => row.name)).toEqual(["ponytail"]);
    expect(rest.map((row) => row.name)).toEqual(["tdd", "grill-me"]);
  });

  it("filters both halves by the query", () => {
    const { favorites, rest } = organizePickerSkills(
      skills,
      new Set(["host:agents:ponytail"]),
      "lazy",
    );
    expect(favorites.map((row) => row.name)).toEqual(["ponytail"]);
    expect(rest).toEqual([]);
  });

  it("returns nothing when the query matches nothing", () => {
    expect(organizePickerSkills(skills, new Set(["host:agents:tdd"]), "zzzz")).toEqual({
      favorites: [],
      rest: [],
    });
  });
});

describe("skillMatchesQuery", () => {
  const row = {
    name: "computer-workflow-organization",
    description: "Organize the desktop",
  };

  it("matches name and description without caring about case", () => {
    expect(skillMatchesQuery(row, "WORKFLOW")).toBe(true);
    expect(skillMatchesQuery(row, "desktop")).toBe(true);
    expect(skillMatchesQuery(row, "missing")).toBe(false);
  });

  it("treats blank queries as a match", () => {
    expect(skillMatchesQuery(row, "  ")).toBe(true);
  });
});
