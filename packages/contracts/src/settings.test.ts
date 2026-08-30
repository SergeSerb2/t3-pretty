import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  PROVIDER_INSTANCE_MAX_COUNT,
  ProviderDriverKind,
  ProviderInstanceId,
} from "./providerInstance.ts";
import {
  BACKGROUND_ACTIVITY_MIN_HOST_POWER_INTERVAL_MILLIS,
  BACKGROUND_ACTIVITY_MIN_IDLE_CLIENT_TTL_MILLIS,
  ClientSettingsSchema,
  ClientSettingsPatch,
  ClaudeSettings,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_SIDEBAR_AUTO_ARCHIVE_SETTLED_AFTER_DAYS,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  SERVER_SETTINGS_CUSTOM_MODELS_MAX_LENGTH,
  SERVER_SETTINGS_PATH_MAX_LENGTH,
  defaultEnabledForDriver,
  resolveProviderInstanceEnabled,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings.ts";
import { SKILL_SETTINGS_MAX_ENABLED } from "./skills.ts";
import { SUBAGENT_POLICY_MAX_CHILDREN } from "./subagentPolicy.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeClaudeSettings = Schema.decodeUnknownSync(ClaudeSettings);

describe("ServerSettings computer control", () => {
  it("is opt-in and accepts an explicit toggle", () => {
    expect(decodeServerSettings({}).enableComputerUse).toBe(false);
    expect(decodeServerSettingsPatch({ enableComputerUse: true }).enableComputerUse).toBe(true);
  });
});

describe("ClaudeSettings auto-compaction", () => {
  it("uses Claude's default threshold when no override is configured", () => {
    expect(decodeClaudeSettings({}).autoCompactWindow).toBe("");
  });

  it.each(["100000", "300000", "1000000"])(
    "accepts a supported auto-compaction threshold: %s",
    (value) => {
      expect(decodeClaudeSettings({ autoCompactWindow: value }).autoCompactWindow).toBe(value);
    },
  );

  it.each(["99999", "1000001", "300k", "invalid"])(
    "rejects an unsupported auto-compaction threshold: %s",
    (value) => {
      expect(() => decodeClaudeSettings({ autoCompactWindow: value })).toThrow();
    },
  );

  it("rejects an unsupported threshold at the settings patch boundary", () => {
    expect(() =>
      decodeServerSettingsPatch({ providers: { claudeAgent: { autoCompactWindow: "300k" } } }),
    ).toThrow();
    expect(
      decodeServerSettingsPatch({ providers: { claudeAgent: { autoCompactWindow: "300000" } } }),
    ).toBeDefined();
  });
});

describe("ServerSettings subagent policy", () => {
  it("defaults to spawning on with no instance pins", () => {
    expect(decodeServerSettings({}).subagentPolicy).toEqual({
      enabled: true,
      children: {},
    });
  });

  it("accepts a global off switch and an instance child pin", () => {
    const decoded = decodeServerSettingsPatch({
      subagentPolicy: {
        enabled: false,
        children: {
          grok: { model: "grok-build", options: [{ id: "reasoningEffort", value: "low" }] },
        },
      },
    });
    expect(decoded.subagentPolicy?.enabled).toBe(false);
    expect(decoded.subagentPolicy?.children?.[ProviderInstanceId.make("grok")]?.model).toBe(
      "grok-build",
    );
  });
});

describe("ClientSettings skill favorites", () => {
  it("defaults to an empty list", () => {
    expect(decodeClientSettings({}).favoriteSkillIds).toEqual([]);
  });

  it("accepts skill ids", () => {
    expect(
      decodeClientSettings({ favoriteSkillIds: ["octo/skills:tdd"] }).favoriteSkillIds,
    ).toEqual(["octo/skills:tdd"]);
    expect(
      decodeClientSettingsPatch({ favoriteSkillIds: ["host:agents:shared"] }).favoriteSkillIds,
    ).toEqual(["host:agents:shared"]);
  });
});

describe("ClientSettings word wrap", () => {
  it("defaults word wrap on", () => {
    expect(decodeClientSettings({}).wordWrap).toBe(true);
  });

  it("ignores obsolete wrapping preferences", () => {
    const decoded = decodeClientSettings({
      chatWordWrap: false,
      diffWordWrap: false,
    });

    expect(decoded.wordWrap).toBe(true);
    expect(decoded).not.toHaveProperty("chatWordWrap");
    expect(decoded).not.toHaveProperty("diffWordWrap");
  });
});

describe("ClientSettings glass opacity", () => {
  it("defaults to a readable translucent surface", () => {
    expect(decodeClientSettings({}).glassOpacity).toBe(80);
  });

  it.each([39, 101, 72.5])("rejects an invalid glass opacity: %s", (value) => {
    expect(() => decodeClientSettings({ glassOpacity: value })).toThrow();
    expect(() => decodeClientSettingsPatch({ glassOpacity: value })).toThrow();
  });

  it.each([40, 75, 100])("accepts a glass opacity within the supported range: %s", (value) => {
    expect(decodeClientSettings({ glassOpacity: value }).glassOpacity).toBe(value);
    expect(decodeClientSettingsPatch({ glassOpacity: value }).glassOpacity).toBe(value);
  });
});

describe("ClientSettings appearance contrast", () => {
  it("defaults to the theme's original contrast", () => {
    expect(decodeClientSettings({}).appearanceContrast).toBe(100);
  });

  it.each([49, 201, 92.5])("rejects an invalid appearance contrast: %s", (value) => {
    expect(() => decodeClientSettings({ appearanceContrast: value })).toThrow();
    expect(() => decodeClientSettingsPatch({ appearanceContrast: value })).toThrow();
  });

  it.each([50, 100, 150, 200])("accepts an appearance contrast in range: %s", (value) => {
    expect(decodeClientSettings({ appearanceContrast: value }).appearanceContrast).toBe(value);
    expect(decodeClientSettingsPatch({ appearanceContrast: value }).appearanceContrast).toBe(value);
  });
});

describe("ClientSettings environment identification", () => {
  it("defaults to artwork and accepts each presentation mode", () => {
    expect(decodeClientSettings({}).environmentIdentificationMode).toBe("artwork");

    for (const mode of ["artwork", "pill", "none"] as const) {
      expect(
        decodeClientSettingsPatch({ environmentIdentificationMode: mode })
          .environmentIdentificationMode,
      ).toBe(mode);
    }
  });

  it("rejects unsupported presentation modes", () => {
    expect(() => decodeClientSettings({ environmentIdentificationMode: "badge" })).toThrow();
    expect(() => decodeClientSettingsPatch({ environmentIdentificationMode: "badge" })).toThrow();
  });
});

describe("ClientSettings sidebar", () => {
  it("defaults to the current sidebar with inactivity settling", () => {
    const settings = decodeClientSettings({});
    expect(settings.legacySidebarEnabled).toBe(false);
    expect(settings.sidebarAutoSettleAfterDays).toBe(3);
    expect(settings).not.toHaveProperty("sidebarAutoSettleOnMerge");
  });

  it("drops the retired sidebar v2 beta keys, resetting everyone to the default", () => {
    const decoded = decodeClientSettings({
      sidebarV2Enabled: false,
      sidebarV2ConfiguredByUser: true,
    });
    expect(decoded.legacySidebarEnabled).toBe(false);
    expect(decoded).not.toHaveProperty("sidebarV2Enabled");
    expect(decoded).not.toHaveProperty("sidebarV2ConfiguredByUser");
  });

  it("preserves an explicit legacy sidebar opt-in", () => {
    expect(decodeClientSettings({ legacySidebarEnabled: true }).legacySidebarEnabled).toBe(true);
    expect(decodeClientSettingsPatch({ legacySidebarEnabled: true }).legacySidebarEnabled).toBe(
      true,
    );
  });

  it("keeps unpin confirmation opt-in and patchable", () => {
    expect(decodeClientSettings({}).confirmThreadUnpin).toBe(false);
    expect(decodeClientSettingsPatch({ confirmThreadUnpin: true }).confirmThreadUnpin).toBe(true);
    expect(() => decodeClientSettingsPatch({ confirmThreadUnpin: "yes" })).toThrow();
  });

  it("allows auto-settle by inactivity to be disabled", () => {
    expect(
      decodeClientSettings({ sidebarAutoSettleAfterDays: null }).sidebarAutoSettleAfterDays,
    ).toBeNull();
  });

  it("drops the retired auto-settle-on-merge setting", () => {
    expect(decodeClientSettings({ sidebarAutoSettleOnMerge: false })).not.toHaveProperty(
      "sidebarAutoSettleOnMerge",
    );
    expect(decodeClientSettingsPatch({ sidebarAutoSettleOnMerge: false })).not.toHaveProperty(
      "sidebarAutoSettleOnMerge",
    );
  });

  it.each([-1, 0, 1.5, 91])("rejects an invalid auto-settle threshold: %s", (value) => {
    expect(() => decodeClientSettings({ sidebarAutoSettleAfterDays: value })).toThrow();
    expect(() => decodeClientSettingsPatch({ sidebarAutoSettleAfterDays: value })).toThrow();
  });

  it("keeps auto-archive off until enabled at a value inside the shared day bounds", () => {
    expect(decodeClientSettings({}).sidebarAutoArchiveSettledAfterDays).toBeNull();
    expect(DEFAULT_SIDEBAR_AUTO_ARCHIVE_SETTLED_AFTER_DAYS).toBeGreaterThanOrEqual(
      MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
    );
    expect(DEFAULT_SIDEBAR_AUTO_ARCHIVE_SETTLED_AFTER_DAYS).toBeLessThanOrEqual(
      MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
    );
    expect(
      decodeClientSettings({
        sidebarAutoArchiveSettledAfterDays: DEFAULT_SIDEBAR_AUTO_ARCHIVE_SETTLED_AFTER_DAYS,
      }).sidebarAutoArchiveSettledAfterDays,
    ).toBe(DEFAULT_SIDEBAR_AUTO_ARCHIVE_SETTLED_AFTER_DAYS);
  });
});

describe("ServerSettings background activity intervals", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    "rejects a non-finite or negative legacy interval: %s",
    (value) => {
      expect(() => decodeServerSettings({ automaticGitFetchInterval: value })).toThrow();
      expect(() => decodeServerSettingsPatch({ providerHealthRefreshInterval: value })).toThrow();
    },
  );

  it("rejects override intervals below their operational minima", () => {
    expect(() =>
      decodeServerSettingsPatch({
        backgroundActivity: {
          overrides: {
            hostPowerMonitorActiveInterval: BACKGROUND_ACTIVITY_MIN_HOST_POWER_INTERVAL_MILLIS - 1,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      decodeServerSettingsPatch({
        backgroundActivity: {
          overrides: {
            idleClientTtl: BACKGROUND_ACTIVITY_MIN_IDLE_CLIENT_TTL_MILLIS - 1,
          },
        },
      }),
    ).toThrow();
  });
});

describe("ServerSettings.providerInstances (slice-2 invariant)", () => {
  it("defaults text generation to Luna at low reasoning effort", () => {
    expect(DEFAULT_SERVER_SETTINGS.textGenerationModelSelection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-luna",
      options: [{ id: "reasoningEffort", value: "low" }],
    });
  });

  it("defaults to an empty record so legacy configs without the key still decode", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
  });

  it("defaults live activity headlines on", () => {
    expect(DEFAULT_SERVER_SETTINGS.generateActivityHeadlines).toBe(true);
  });

  it("decodes a fully empty config (legacy on-disk shape) without complaint", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providerInstances).toEqual({});
    // Legacy `providers` struct is still hydrated with its per-driver defaults
    // so existing call sites keep working through the migration.
    expect(decoded.providers.codex.enabled).toBe(true);
  });

  it("decodes a multi-instance map mixing first-party and fork drivers", () => {
    const decoded = decodeServerSettings({
      providerInstances: {
        codex_personal: {
          driver: "codex",
          displayName: "Codex (personal)",
          config: { homePath: "~/.codex_personal" },
        },
        codex_work: {
          driver: "codex",
          config: { homePath: "~/.codex_work" },
        },
        ollama_local: {
          driver: "ollama",
          displayName: "Ollama (local)",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const personalId = ProviderInstanceId.make("codex_personal");
    const workId = ProviderInstanceId.make("codex_work");
    const ollamaId = ProviderInstanceId.make("ollama_local");

    expect(decoded.providerInstances[personalId]?.driver).toBe("codex");
    expect(decoded.providerInstances[workId]?.config).toEqual({ homePath: "~/.codex_work" });
    // Critical: a config naming a driver this build does not know about
    // (`ollama` is not in `ProviderDriverKind`) must round-trip without loss.
    // The runtime handles "driver not installed" — the schema must not.
    expect(decoded.providerInstances[ollamaId]?.driver).toBe("ollama");
    expect(decoded.providerInstances[ollamaId]?.config).toEqual({
      endpoint: "http://localhost:11434",
    });
  });

  it("rejects instance keys that violate the slug pattern", () => {
    expect(() =>
      decodeServerSettings({
        providerInstances: { "1bad": { driver: "codex" } },
      }),
    ).toThrow();
  });
});

describe("provider enabled defaults", () => {
  it("enables only the stable bindings by default", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providers.codex.enabled).toBe(true);
    expect(decoded.providers.claudeAgent.enabled).toBe(true);
    expect(decoded.providers.cursor.enabled).toBe(false);
    expect(decoded.providers.grok.enabled).toBe(false);
    expect(decoded.providers.kimi.enabled).toBe(true);
  });

  it("derives per-driver defaults from the settings schemas", () => {
    expect(defaultEnabledForDriver(ProviderDriverKind.make("codex"))).toBe(true);
    expect(defaultEnabledForDriver(ProviderDriverKind.make("cursor"))).toBe(false);
    expect(defaultEnabledForDriver(ProviderDriverKind.make("grok"))).toBe(false);
    // Unknown fork drivers stay enabled; their own build decides otherwise.
    expect(defaultEnabledForDriver(ProviderDriverKind.make("ollama"))).toBe(true);
  });

  it("keeps Cursor enabled when an existing user explicitly opted in", () => {
    const cursor = ProviderDriverKind.make("cursor");
    const cursorId = ProviderInstanceId.make("cursor");
    const decoded = decodeServerSettings({
      providers: { cursor: { enabled: true } },
      providerInstances: {
        [cursorId]: { driver: cursor, enabled: true, config: {} },
      },
    });

    expect(decoded.providers.cursor.enabled).toBe(true);
    expect(resolveProviderInstanceEnabled(decoded.providerInstances[cursorId]!)).toBe(true);
  });

  it("resolves instance enabled state with explicit false winning", () => {
    const grok = ProviderDriverKind.make("grok");
    const codex = ProviderDriverKind.make("codex");
    // No flags anywhere: driver default applies.
    expect(resolveProviderInstanceEnabled({ driver: grok, config: {} })).toBe(false);
    expect(resolveProviderInstanceEnabled({ driver: codex, config: {} })).toBe(true);
    // Envelope flag wins over the driver default.
    expect(resolveProviderInstanceEnabled({ driver: grok, enabled: true, config: {} })).toBe(true);
    expect(resolveProviderInstanceEnabled({ driver: codex, enabled: false, config: {} })).toBe(
      false,
    );
    // Legacy in-config flag fills in when the envelope is silent.
    expect(resolveProviderInstanceEnabled({ driver: grok, config: { enabled: true } })).toBe(true);
    // Conflicting flags: the explicit false wins, whichever side it is on.
    expect(
      resolveProviderInstanceEnabled({ driver: grok, enabled: true, config: { enabled: false } }),
    ).toBe(false);
    expect(
      resolveProviderInstanceEnabled({ driver: codex, enabled: false, config: { enabled: true } }),
    ).toBe(false);
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults start-from-origin on for legacy configs", () => {
    expect(decodeServerSettings({}).newWorktreesStartFromOrigin).toBe(true);
  });

  it("accepts start-from-origin updates", () => {
    expect(
      decodeServerSettingsPatch({ newWorktreesStartFromOrigin: false }).newWorktreesStartFromOrigin,
    ).toBe(false);
  });
});

describe("ServerSettings.sourceControlWritingStyle", () => {
  it("defaults all style settings for legacy configs", () => {
    const settings = decodeServerSettings({});

    expect(settings.sourceControlWritingStyle).toEqual({
      mode: "repo_conventions",
      customInstructions: "",
      followChangeRequestTemplates: true,
    });
    expect(settings.sourceControlWriterModelSelection).toBeNull();
  });

  it("trims partial style updates", () => {
    const patch = decodeServerSettingsPatch({
      sourceControlWritingStyle: {
        mode: "custom",
        customInstructions: "  Prefer concise wording.  ",
      },
    });

    expect(patch.sourceControlWritingStyle).toEqual({
      mode: "custom",
      customInstructions: "Prefer concise wording.",
    });
  });
});

describe("ServerSettingsPatch.providerInstances", () => {
  it("treats providerInstances as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.providerInstances).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      providerInstances: {
        codex_personal: { driver: "codex", config: { homePath: "~/.codex" } },
      },
    });
    expect(replacement.providerInstances).toBeDefined();
    expect(replacement.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
  });

  it("preserves a fork-defined driver entry through patch decoding", () => {
    const patch = decodeServerSettingsPatch({
      providerInstances: {
        ollama_local: {
          driver: "ollama",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const ollamaId = ProviderInstanceId.make("ollama_local");
    expect(patch.providerInstances?.[ollamaId]?.driver).toBe("ollama");
  });
});

describe("ServerSettingsPatch string normalization", () => {
  it("trims string settings while decoding patches", () => {
    const patch = decodeServerSettingsPatch({
      addProjectBaseDirectory: "  ~/Development  ",
      textGenerationModelSelection: { model: "  gpt-5.4-mini  " },
      observability: {
        otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
      },
      providers: {
        codex: {
          binaryPath: "  /opt/homebrew/bin/codex  ",
          homePath: "  ~/.codex  ",
          launchArgs: "  --strict-config --enable foo  ",
        },
      },
      providerInstances: {
        codex_personal: {
          driver: "  codex  ",
          displayName: "  Codex Personal  ",
          config: { homePath: "  ~/.codex-personal  " },
        },
      },
    });

    expect(patch.addProjectBaseDirectory).toBe("~/Development");
    expect(patch.textGenerationModelSelection?.model).toBe("gpt-5.4-mini");
    expect(patch.observability?.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
    expect(patch.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(patch.providers?.codex?.homePath).toBe("~/.codex");
    expect(patch.providers?.codex?.launchArgs).toBe("--strict-config --enable foo");
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.displayName).toBe(
      "Codex Personal",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.config).toEqual({
      homePath: "  ~/.codex-personal  ",
    });
  });

  it("trims encoded server settings values before validation", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      addProjectBaseDirectory: "  ~/Development  ",
      providers: {
        ...defaultSettings.providers,
        codex: {
          ...defaultSettings.providers.codex,
          binaryPath: "  /opt/homebrew/bin/codex  ",
          launchArgs: "  --strict-config  ",
        },
      },
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(encoded.providers?.codex?.launchArgs).toBe("--strict-config");
  });
});

describe("ServerSettings collection and string bounds", () => {
  it("rejects oversized custom-model lists in full settings and patches", () => {
    const customModels = Array.from(
      { length: SERVER_SETTINGS_CUSTOM_MODELS_MAX_LENGTH + 1 },
      (_, index) => `model-${index}`,
    );

    expect(() => decodeServerSettings({ providers: { codex: { customModels } } })).toThrow();
    expect(() => decodeServerSettingsPatch({ providers: { codex: { customModels } } })).toThrow();
  });

  it("rejects oversized provider, skill, and subagent maps before persistence", () => {
    const providerInstances = Object.fromEntries(
      Array.from({ length: PROVIDER_INSTANCE_MAX_COUNT + 1 }, (_, index) => [
        `provider${index}`,
        { driver: "codex" },
      ]),
    );
    const enabledSkillIds = Array.from(
      { length: SKILL_SETTINGS_MAX_ENABLED + 1 },
      (_, index) => `example/skills:skill-${index}`,
    );
    const children = Object.fromEntries(
      Array.from({ length: SUBAGENT_POLICY_MAX_CHILDREN + 1 }, (_, index) => [
        `provider${index}`,
        { model: "gpt-5.6-luna" },
      ]),
    );

    expect(() => decodeServerSettingsPatch({ providerInstances })).toThrow();
    expect(() => decodeServerSettingsPatch({ skills: { enabledSkillIds } })).toThrow();
    expect(() => decodeServerSettingsPatch({ subagentPolicy: { children } })).toThrow();
  });

  it("rejects path fields beyond the supported ceiling", () => {
    const oversizedPath = `/${"a".repeat(SERVER_SETTINGS_PATH_MAX_LENGTH)}`;

    expect(() => decodeServerSettings({ addProjectBaseDirectory: oversizedPath })).toThrow();
    expect(() => decodeServerSettingsPatch({ addProjectBaseDirectory: oversizedPath })).toThrow();
  });
});
