import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type HostSkill, type InstalledSkill } from "@t3tools/contracts";

import { toPickerSkills } from "./SkillsPicker";

describe("toPickerSkills", () => {
  const claude = ProviderDriverKind.make("claudeAgent");
  const codex = ProviderDriverKind.make("codex");
  const installed: InstalledSkill[] = [
    {
      id: "octo/skills:tdd",
      name: "tdd",
      sourceRepo: "octo/skills",
      sourcePath: "tdd",
      installedAt: "2026-08-15T00:00:00.000Z",
    },
  ];
  const host: HostSkill[] = [
    {
      id: "host:claudeAgent:grill-me",
      name: "grill-me",
      path: "/home/u/.claude/skills/grill-me/SKILL.md",
      displayPath: "~/.claude/skills/grill-me",
      origin: "Claude Code",
      enabled: true,
      driver: claude,
    },
    {
      id: "host:codex:review",
      name: "review",
      path: "/home/u/.codex/skills/review/SKILL.md.t3-disabled",
      displayPath: "~/.codex/skills/review",
      origin: "Codex",
      enabled: false,
      driver: codex,
    },
    {
      id: "host:agents:shared",
      name: "shared",
      path: "/home/u/.agents/skills/shared/SKILL.md",
      displayPath: "~/.agents/skills/shared",
      origin: "Shared",
      enabled: true,
    },
  ];

  it("locks global library picks and the selected provider's own enabled host skills", () => {
    const skills = toPickerSkills(installed, host, new Set(["octo/skills:tdd"]), claude);
    expect(skills.map((skill) => [skill.id, skill.group, skill.locked])).toEqual([
      ["octo/skills:tdd", "Library", true],
      ["host:claudeAgent:grill-me", "Claude Code", true],
      ["host:codex:review", "Codex", false],
      ["host:agents:shared", "Shared", false],
    ]);
  });

  it("leaves another provider's host skills toggleable", () => {
    const skills = toPickerSkills(installed, host, new Set(), codex);
    expect(skills.find((skill) => skill.id === "host:claudeAgent:grill-me")?.locked).toBe(false);
    expect(skills.find((skill) => skill.id === "octo/skills:tdd")?.locked).toBe(false);
  });

  it("falls back to the host path when a skill has no description", () => {
    const skills = toPickerSkills([], host, new Set(), claude);
    expect(skills[0]?.description).toBe("~/.claude/skills/grill-me");
  });
});
