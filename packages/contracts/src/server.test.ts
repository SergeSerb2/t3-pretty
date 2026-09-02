import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ServerConfig,
  ServerProcessDiagnosticsEntry,
  ServerProvider,
  ServerProviders,
  ServerTraceDiagnosticsResult,
  ServerTraceDiagnosticsSpanSummary,
  SERVER_PROCESS_DIAGNOSTIC_MAX_COUNT,
  SERVER_PROVIDER_MODELS_MAX_ITEMS,
  SERVER_PROVIDERS_MAX_ITEMS,
  SERVER_TRACE_DIAGNOSTIC_LOG_LEVEL_MAX_COUNT,
  SERVER_TRACE_DIAGNOSTIC_TEXT_MAX_LENGTH,
  SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT,
  ServerUpsertKeybindingResult,
} from "./server.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);
const decodeServerProviders = Schema.decodeUnknownSync(ServerProviders);
const decodeUpsertKeybindingResult = Schema.decodeUnknownSync(ServerUpsertKeybindingResult);
const decodeAvailableEditors = Schema.decodeUnknownSync(ServerConfig.fields.availableEditors);
const decodeTraceSpanSummary = Schema.decodeUnknownSync(ServerTraceDiagnosticsSpanSummary);
const decodeTraceTopSpans = Schema.decodeUnknownSync(
  ServerTraceDiagnosticsResult.fields.topSpansByCount,
);
const decodeTraceLogLevelCounts = Schema.decodeUnknownSync(
  ServerTraceDiagnosticsResult.fields.logLevelCounts,
);
const decodeProcessChildPids = Schema.decodeUnknownSync(
  ServerProcessDiagnosticsEntry.fields.childPids,
);

const baseProviderSnapshot = {
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [],
};

describe("ServerProvider", () => {
  it("defaults capability arrays when decoding provider snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.slashCommands).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.versionAdvisory).toBeUndefined();
    expect(parsed.updateState).toBeUndefined();
  });

  it("defaults one-click update support when decoding older advisory snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        updateCommand: "npm install -g @openai/codex@latest",
        checkedAt: "2026-04-10T00:00:00.000Z",
        message: "Update available.",
      },
    });

    expect(parsed.versionAdvisory?.canUpdate).toBe(false);
  });

  it("decodes continuation group metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex_personal",
      driver: "codex",
      continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.continuation?.groupKey).toBe("codex:home:/Users/julius/.codex");
  });

  it("decodes optional legacy model metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          isLegacy: true,
          capabilities: null,
        },
      ],
    });

    expect(parsed.models[0]?.isLegacy).toBe(true);
  });

  it("rejects provider snapshots with oversized model collections", () => {
    const model = {
      slug: "model",
      name: "Model",
      isCustom: false,
      capabilities: null,
    };
    expect(() =>
      decodeServerProvider({
        ...baseProviderSnapshot,
        models: Array.from({ length: SERVER_PROVIDER_MODELS_MAX_ITEMS + 1 }, () => model),
      }),
    ).toThrow();
  });
});

describe("server config forward compatibility", () => {
  it("drops config issues with kinds this build does not know", () => {
    const parsed = decodeUpsertKeybindingResult({
      keybindings: [],
      issues: [
        { kind: "keybindings.invalid-entry", message: "Bad entry", index: 2 },
        { kind: "keybindings.future-issue", message: "From a newer server" },
      ],
    });

    expect(parsed.issues).toEqual([
      { kind: "keybindings.invalid-entry", message: "Bad entry", index: 2 },
    ]);
  });

  it("drops editor ids this build does not know", () => {
    const parsed = decodeAvailableEditors(["zed", "some-future-editor", "vscode"]);

    expect(parsed).toEqual(["zed", "vscode"]);
  });

  // A provider status this build has never seen (a new ServerProviderState,
  // ServerProviderAuthStatus, etc. member) previously failed the whole
  // `providers` array, taking every other provider down with it and, since
  // `providers` sits inside `ServerConfig`, failing the whole config decode —
  // an older client would drop its connection over one provider it can't
  // render. Dropping just that element keeps every other provider working.
  it("drops providers this build cannot decode instead of failing the whole array", () => {
    const decodedBase = decodeServerProvider(baseProviderSnapshot);

    const parsed = decodeServerProviders([
      baseProviderSnapshot,
      { ...baseProviderSnapshot, instanceId: "future", status: "some-future-status" },
    ]);

    expect(parsed).toEqual([decodedBase]);
  });

  it("rejects provider collections beyond the server snapshot budget", () => {
    expect(() =>
      decodeServerProviders(
        Array.from({ length: SERVER_PROVIDERS_MAX_ITEMS + 1 }, () => baseProviderSnapshot),
      ),
    ).toThrow();
  });
});

describe("server diagnostics payload bounds", () => {
  const spanSummary = {
    name: "server.getConfig",
    count: 1,
    failureCount: 0,
    totalDurationMs: 10,
    averageDurationMs: 10,
    maxDurationMs: 10,
  };

  it("rejects oversized trace detail strings and collections", () => {
    expect(() =>
      decodeTraceSpanSummary({
        ...spanSummary,
        name: "x".repeat(SERVER_TRACE_DIAGNOSTIC_TEXT_MAX_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeTraceTopSpans(
        Array.from({ length: SERVER_TRACE_DIAGNOSTIC_TOP_MAX_COUNT + 1 }, () => spanSummary),
      ),
    ).toThrow();
  });

  it("rejects oversized trace records and process descendant lists", () => {
    expect(() =>
      decodeTraceLogLevelCounts(
        Object.fromEntries(
          Array.from({ length: SERVER_TRACE_DIAGNOSTIC_LOG_LEVEL_MAX_COUNT + 1 }, (_, index) => [
            `level-${index}`,
            1,
          ]),
        ),
      ),
    ).toThrow();
    expect(() =>
      decodeProcessChildPids(
        Array.from({ length: SERVER_PROCESS_DIAGNOSTIC_MAX_COUNT + 1 }, (_, index) => index + 1),
      ),
    ).toThrow();
  });
});
