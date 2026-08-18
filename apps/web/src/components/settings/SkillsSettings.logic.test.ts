import { describe, expect, it } from "vite-plus/test";

import {
  displaySkillRows,
  finishTombstoneExit,
  groupSkillRowsByOrigin,
  hostSkillCanUninstall,
  hostSkillKindLabel,
  nextSkillOrderIds,
  originGroupId,
  pruneHiddenSkillIds,
  retainedSkillIds,
  skillTextMatches,
  skillsTabForSearchTarget,
} from "./SkillsSettings.logic";

const alpha = { id: "alpha", name: "Alpha" };
const beta = { id: "beta", name: "Beta" };
const gamma = { id: "gamma", name: "Gamma" };

describe("pruneHiddenSkillIds", () => {
  it("drops tombstones the server list no longer contains", () => {
    const hidden = new Set(["alpha", "beta"]);
    expect([...pruneHiddenSkillIds(hidden, new Set(["beta"]))]).toEqual(["beta"]);
  });

  it("returns the same set when nothing changed", () => {
    const hidden = new Set(["alpha"]);
    expect(pruneHiddenSkillIds(hidden, new Set(["alpha", "beta"]))).toBe(hidden);
  });
});

describe("nextSkillOrderIds", () => {
  it("keeps existing order and appends newly installed skills", () => {
    expect(
      nextSkillOrderIds(
        ["beta", "alpha"],
        ["alpha", "beta", "gamma"],
        new Set(["alpha", "beta", "gamma"]),
      ),
    ).toEqual(["beta", "alpha", "gamma"]);
  });

  it("keeps an exiting id after the server drops it", () => {
    expect(
      nextSkillOrderIds(
        ["alpha", "beta", "gamma"],
        ["alpha", "gamma"],
        new Set(["alpha", "beta", "gamma"]),
      ),
    ).toEqual(["alpha", "beta", "gamma"]);
  });

  it("drops ids that are gone from both the server and the exiting set", () => {
    expect(nextSkillOrderIds(["alpha", "beta"], ["alpha"], new Set(["alpha"]))).toEqual(["alpha"]);
  });
});

describe("displaySkillRows", () => {
  it("keeps an exiting skill in place after the server snapshot drops it", () => {
    const exiting = new Map([[beta.id, beta]]);
    const hidden = new Set([beta.id]);
    expect(displaySkillRows([alpha, gamma], hidden, exiting, ["alpha", "beta", "gamma"])).toEqual([
      { skill: alpha, exiting: false },
      { skill: beta, exiting: true },
      { skill: gamma, exiting: false },
    ]);
  });

  it("hides a finished tombstone even while the server snapshot is still stale", () => {
    const hidden = new Set([beta.id]);
    expect(
      displaySkillRows([alpha, beta, gamma], hidden, new Map(), ["alpha", "beta", "gamma"]),
    ).toEqual([
      { skill: alpha, exiting: false },
      { skill: gamma, exiting: false },
    ]);
  });

  it("appends skills that appear on the server before order has caught up", () => {
    expect(displaySkillRows([alpha, beta], new Set(), new Map(), ["alpha"])).toEqual([
      { skill: alpha, exiting: false },
      { skill: beta, exiting: false },
    ]);
  });
});

describe("retainedSkillIds", () => {
  it("unions the live server ids with skills still animating out", () => {
    expect([...retainedSkillIds([alpha], new Map([[beta.id, beta]]))].sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });
});

describe("skills settings navigation", () => {
  it("maps settings-search anchors onto the matching tab", () => {
    expect(skillsTabForSearchTarget("skills-marketplace")).toBe("marketplace");
    expect(skillsTabForSearchTarget("skills-on-environment")).toBe("machine");
    expect(skillsTabForSearchTarget("skills-installed")).toBe("library");
    expect(skillsTabForSearchTarget(null)).toBeNull();
  });

  it("matches skill text case-insensitively and treats empty query as a match", () => {
    expect(skillTextMatches("", ["Using Superpowers"])).toBe(true);
    expect(skillTextMatches("super", ["Using Superpowers", "Claude Code"])).toBe(true);
    expect(skillTextMatches("codex", ["grill-me", "Claude Code"])).toBe(false);
  });

  it("labels plugin kinds and blocks uninstall for plugin, bundled, and system skills", () => {
    expect(hostSkillKindLabel("plugin")).toBe("Plugin");
    expect(hostSkillKindLabel("bundled")).toBe("Bundled");
    expect(hostSkillKindLabel("system")).toBe("Built-in");
    expect(hostSkillKindLabel("user")).toBeNull();
    expect(hostSkillCanUninstall({ kind: "plugin" })).toBe(false);
    expect(hostSkillCanUninstall({ kind: "user" })).toBe(true);
    expect(hostSkillCanUninstall({ kind: "user", canUninstall: false })).toBe(false);
  });

  it("groups rows by origin and builds a stable jump id", () => {
    expect(
      groupSkillRowsByOrigin([
        { skill: { origin: "Claude Code" } },
        { skill: { origin: "Codex" } },
        { skill: { origin: "Claude Code" } },
      ]),
    ).toEqual([
      ["Claude Code", [{ skill: { origin: "Claude Code" } }, { skill: { origin: "Claude Code" } }]],
      ["Codex", [{ skill: { origin: "Codex" } }]],
    ]);
    expect(originGroupId("Claude Code · Work")).toBe("skills-origin-claude-code-work");
  });
});

describe("finishTombstoneExit", () => {
  it("is a no-op when the skill is not exiting", () => {
    const exiting = new Map([[alpha.id, alpha]]);
    expect(finishTombstoneExit(exiting, beta.id)).toBe(exiting);
  });

  it("removes a finished exit without touching other tombstones", () => {
    const exiting = new Map([
      [alpha.id, alpha],
      [beta.id, beta],
    ]);
    expect([...finishTombstoneExit(exiting, alpha.id).keys()]).toEqual(["beta"]);
  });
});
