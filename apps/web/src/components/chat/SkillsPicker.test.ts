import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type HostSkill,
  type InstalledSkill,
} from "@t3tools/contracts";

import { toPickerSkills } from "./SkillsPicker";

describe("toPickerSkills", () => {
  const claude = ProviderDriverKind.make("claudeAgent");
  const codex = ProviderDriverKind.make("codex");
  const claudeDefault = ProviderInstanceId.make("claudeAgent");
  const codexDefault = ProviderInstanceId.make("codex");
  const codexPersonal = ProviderInstanceId.make("codex_personal");
  const codexWork = ProviderInstanceId.make("codex_work");
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
    {
      id: "host:codex:codex_personal:personal-only",
      name: "personal-only",
      path: "/home/u/.codex-personal/skills/personal-only/SKILL.md",
      displayPath: "~/.codex-personal/skills/personal-only",
      origin: "Codex · Personal",
      enabled: true,
      driver: codex,
      instanceId: codexPersonal,
    },
    {
      id: "host:codex:codex_work:work-only",
      name: "work-only",
      path: "/home/u/.codex-work/skills/work-only/SKILL.md",
      displayPath: "~/.codex-work/skills/work-only",
      origin: "Codex · Work",
      enabled: true,
      driver: codex,
      instanceId: codexWork,
    },
  ];

  it("locks global library picks and the selected instance's own enabled host skills", () => {
    const skills = toPickerSkills(installed, host, new Set(["octo/skills:tdd"]), claudeDefault);
    expect(skills.map((skill) => [skill.id, skill.group, skill.locked])).toEqual([
      ["octo/skills:tdd", "Library", true],
      ["host:claudeAgent:grill-me", "Claude Code", true],
      ["host:codex:review", "Codex", false],
      ["host:agents:shared", "Shared", false],
      ["host:codex:codex_personal:personal-only", "Codex · Personal", false],
      ["host:codex:codex_work:work-only", "Codex · Work", false],
    ]);
  });

  it("leaves another provider's host skills toggleable", () => {
    const skills = toPickerSkills(installed, host, new Set(), codexDefault);
    expect(skills.find((skill) => skill.id === "host:claudeAgent:grill-me")?.locked).toBe(false);
    expect(skills.find((skill) => skill.id === "octo/skills:tdd")?.locked).toBe(false);
  });

  it("locks only the selected sibling instance's enabled host skills", () => {
    const skills = toPickerSkills(installed, host, new Set(), codexPersonal);
    expect(
      skills.find((skill) => skill.id === "host:codex:codex_personal:personal-only")?.locked,
    ).toBe(true);
    expect(skills.find((skill) => skill.id === "host:codex:codex_work:work-only")?.locked).toBe(
      false,
    );
    // Default Codex home has no instanceId; it belongs to the default instance, not this sibling.
    expect(skills.find((skill) => skill.id === "host:codex:review")?.locked).toBe(false);
  });

  it("treats default-home host skills as the driver's default instance", () => {
    const skills = toPickerSkills([], host, new Set(), codexDefault);
    expect(skills.find((skill) => skill.id === "host:codex:review")?.locked).toBe(false);
    expect(
      skills.find((skill) => skill.id === "host:codex:codex_personal:personal-only")?.locked,
    ).toBe(false);
  });

  it("falls back to the host path when a skill has no description", () => {
    const skills = toPickerSkills([], host, new Set(), claudeDefault);
    expect(skills[0]?.description).toBe("~/.claude/skills/grill-me");
  });
});
