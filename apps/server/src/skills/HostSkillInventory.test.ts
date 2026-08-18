import { describe, expect, it } from "vite-plus/test";

import {
  formatHostSkillId,
  parseClaudeInstalledPluginInstallPaths,
  parseCodexEnabledPluginRefs,
  parseGrokInstalledPluginRoots,
  parseHostSkillId,
  pickPluginVersionDirectory,
  pluginInstanceKey,
} from "./HostSkillInventory.ts";

describe("parseHostSkillId", () => {
  it("parses flat, instance, and nested host skill ids", () => {
    expect(parseHostSkillId("host:claudeAgent:grill-me")).toEqual({
      originKey: "claudeAgent",
      instanceKey: "",
      dirName: "grill-me",
    });
    expect(parseHostSkillId("host:codex:codex_work:tdd")).toEqual({
      originKey: "codex",
      instanceKey: "codex_work",
      dirName: "tdd",
    });
    expect(parseHostSkillId("host:claudeAgent:superpowers/skills/using-superpowers")).toEqual({
      originKey: "claudeAgent",
      instanceKey: "",
      dirName: "superpowers/skills/using-superpowers",
    });
    expect(parseHostSkillId("host:codex:_p_sites:sites/create")).toEqual({
      originKey: "codex",
      instanceKey: "_p_sites",
      dirName: "sites/create",
    });
  });

  it("rejects traversal, empty, and foreign ids", () => {
    expect(parseHostSkillId("host:codex::tdd")).toBeNull();
    expect(parseHostSkillId("host:codex:../tdd")).toBeNull();
    expect(parseHostSkillId("host:codex:foo/../tdd")).toBeNull();
    expect(parseHostSkillId("mattpocock/skills:skills/tdd")).toBeNull();
  });
});

describe("formatHostSkillId", () => {
  it("round-trips nested plugin paths", () => {
    const id = formatHostSkillId({
      originKey: "claudeAgent",
      instanceKey: "",
      dirName: "superpowers/skills/using-superpowers",
    });
    expect(id).toBe("host:claudeAgent:superpowers/skills/using-superpowers");
    expect(parseHostSkillId(id)?.dirName).toBe("superpowers/skills/using-superpowers");
  });
});

describe("parseClaudeInstalledPluginInstallPaths", () => {
  it("reads version-2 array entries and ignores junk", () => {
    expect(
      parseClaudeInstalledPluginInstallPaths(
        JSON.stringify({
          version: 2,
          plugins: {
            "caveman@caveman": [
              { scope: "user", installPath: "/Users/u/.claude/plugins/cache/caveman" },
            ],
            "broken@x": { installPath: 3 },
          },
        }),
      ),
    ).toEqual([{ id: "caveman@caveman", installPath: "/Users/u/.claude/plugins/cache/caveman" }]);
  });

  it("returns an empty list for invalid JSON", () => {
    expect(parseClaudeInstalledPluginInstallPaths("{")).toEqual([]);
  });
});

describe("parseGrokInstalledPluginRoots", () => {
  it("reads repo paths from the plugin registry", () => {
    expect(
      parseGrokInstalledPluginRoots(
        JSON.stringify({
          version: 1,
          repos: {
            "ponytail-abc": { path: "/Users/u/.grok/installed-plugins/ponytail-abc" },
            empty: {},
          },
        }),
      ),
    ).toEqual([{ id: "ponytail-abc", path: "/Users/u/.grok/installed-plugins/ponytail-abc" }]);
  });
});

describe("parseCodexEnabledPluginRefs", () => {
  it("keeps listed plugins and skips disabled ones", () => {
    expect(
      parseCodexEnabledPluginRefs(`
[plugins."sites@openai-bundled"]
enabled = true

[plugins."vercel@openai-curated-remote"]
enabled = false

[plugins."ponytail@ponytail"]
`),
    ).toEqual([
      { name: "sites", marketplace: "openai-bundled" },
      { name: "ponytail", marketplace: "ponytail" },
    ]);
  });
});

describe("pickPluginVersionDirectory", () => {
  it("prefers latest, then the highest numeric name", () => {
    expect(pickPluginVersionDirectory(["0.1.0", "latest", "0.2.0"])).toBe("latest");
    expect(pickPluginVersionDirectory(["0.1.2", "0.21.4", "0.2.0"])).toBe("0.21.4");
  });
});

describe("pluginInstanceKey", () => {
  it("slugifies plugin labels into reserved instance keys", () => {
    expect(pluginInstanceKey("sites@openai-bundled")).toBe("_p_sites-openai-bundled");
    expect(pluginInstanceKey("sites@openai-bundled", "codex_work")).toBe(
      "_p_codex_work-sites-openai-bundled",
    );
  });
});
