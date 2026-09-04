import { describe, expect, it } from "vite-plus/test";

import {
  ProviderInstanceId,
  ServerProvider,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { ModelOption } from "../../lib/modelOptions";
import {
  canCommitPendingModel,
  effectiveProviderFilter,
  initialProviderFilter,
  modelMatchesCatalogQuery,
  pendingModelAfterPress,
  presentedSettingsSheetPage,
  providerSetupCandidates,
  threadSettingsSheetPageForRoute,
  visibleSheetOptionDescriptors,
} from "./thread-settings-sheet-state";

function modelOption(
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> = [],
): ModelOption {
  return {
    key: `codex:${model}`,
    label: model,
    subtitle: "",
    providerKey: "codex",
    providerLabel: "Codex",
    providerDriver: "codex",
    isDefault: false,
    isLegacy: false,
    capabilities: null,
    selection: {
      instanceId: ProviderInstanceId.make("codex"),
      model,
      options,
    },
  };
}

describe("thread settings sheet state", () => {
  it("matches visible model and provider terms", () => {
    const model = modelOption("gpt-next");

    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "NEXT" })).toBe(true);
    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "codex" })).toBe(true);
    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "claude" })).toBe(
      false,
    );
  });

  it("treats whitespace-only catalog searches as empty", () => {
    expect(
      modelMatchesCatalogQuery({
        model: modelOption("gpt-next"),
        providerLabel: "Codex",
        query: "   ",
      }),
    ).toBe(true);
  });

  it("matches the upstream provider's display name", () => {
    const model = {
      ...modelOption("opencode/claude-fable-5"),
      label: "Claude Fable 5",
      subtitle: "OpenCode Zen",
    };

    expect(modelMatchesCatalogQuery({ model, providerLabel: "OpenCode", query: " ZEN " })).toBe(
      true,
    );
    expect(modelMatchesCatalogQuery({ model, providerLabel: "OpenCode", query: "copilot" })).toBe(
      false,
    );
  });

  it("clears staging when the applied model is pressed", () => {
    expect(
      pendingModelAfterPress({
        current: modelOption("gpt-next"),
        pressed: modelOption("gpt-current"),
        pressedIsApplied: true,
      }),
    ).toBeNull();
  });

  it("preserves staged options when the highlighted model is pressed again", () => {
    const pending = modelOption("gpt-next", [{ id: "effort", value: "high" }]);

    expect(
      pendingModelAfterPress({
        current: pending,
        pressed: modelOption("gpt-next"),
        pressedIsApplied: false,
      }),
    ).toBe(pending);
  });

  it("stages a different model", () => {
    const pressed = modelOption("gpt-other");

    expect(
      pendingModelAfterPress({
        current: modelOption("gpt-next"),
        pressed,
        pressedIsApplied: false,
      }),
    ).toBe(pressed);
  });

  it("cannot save a staged model after sign-out removes it from the catalog", () => {
    const pending = modelOption("gemini-native");
    const group = { providerKey: "codex", providerLabel: "Codex", models: [pending] };

    expect(canCommitPendingModel(pending, [group])).toBe(true);
    expect(canCommitPendingModel(pending, [])).toBe(false);
    expect(
      canCommitPendingModel(pending, [
        {
          ...group,
          models: [{ ...pending, isUnavailable: true }],
        },
      ]),
    ).toBe(false);
  });
});

const decodeServerProvider = Schema.decodeSync(ServerProvider);

function setupProvider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return decodeServerProvider({
    instanceId: "antigravity",
    driver: "antigravity",
    displayName: "Antigravity",
    enabled: false,
    installed: false,
    version: null,
    status: "disabled",
    auth: { status: "unauthenticated" },
    checkedAt: "2026-09-02T00:00:00.000Z",
    setup: { canAuthenticate: true, canInstall: true },
    models: [],
    ...overrides,
  });
}

describe("providerSetupCandidates", () => {
  const unfiltered = { providerFilter: null, query: "" };

  it("offers setup without a selectable model and after sign-out", () => {
    const disabled = setupProvider();
    const signedOut = setupProvider({ enabled: true, installed: true });

    expect(providerSetupCandidates({ providers: [disabled], ...unfiltered })).toEqual([disabled]);
    expect(providerSetupCandidates({ providers: [signedOut], ...unfiltered })).toEqual([signedOut]);
  });

  it("uses the selected environment's status for identical instance IDs", () => {
    const offlineAccount = setupProvider();
    const readyAccount = setupProvider({
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: [{ slug: "gemini-native", name: "Gemini", isCustom: false, capabilities: null }],
    });

    expect(providerSetupCandidates({ providers: [offlineAccount], ...unfiltered })).toHaveLength(1);
    expect(providerSetupCandidates({ providers: [readyAccount], ...unfiltered })).toEqual([]);
  });

  it("limits existing threads to their provider and respects search", () => {
    const personal = setupProvider();
    const work = setupProvider({
      instanceId: ProviderInstanceId.make("google_work"),
      displayName: "Work Google",
    });

    expect(
      providerSetupCandidates({
        providers: [personal, work],
        ...unfiltered,
        instanceId: work.instanceId,
      }),
    ).toEqual([work]);
    expect(
      providerSetupCandidates({
        providers: [personal, work],
        providerFilter: work.instanceId,
        query: "work",
      }),
    ).toEqual([work]);
    expect(
      providerSetupCandidates({
        providers: [personal, work],
        providerFilter: null,
        query: "no-match",
      }),
    ).toEqual([]);
  });
});

const reasoning: ProviderOptionDescriptor = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    { id: "ultrathink", label: "Ultrathink" },
    { id: "ultracode", label: "Ultracode" },
  ],
  currentValue: "high",
  promptInjectedValues: ["ultrathink"],
};

const fastMode: ProviderOptionDescriptor = {
  id: "fastMode",
  label: "Fast Mode",
  type: "boolean",
  currentValue: false,
};

describe("visible sheet option descriptors", () => {
  it("keeps only the advertised options, dropping empty select catalogs", () => {
    const emptySelect: ProviderOptionDescriptor = {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [{ id: "ultracode", label: "Ultracode" }],
      currentValue: "ultracode",
    };

    expect(
      visibleSheetOptionDescriptors([reasoning, fastMode, emptySelect]).map(
        (descriptor) => descriptor.id,
      ),
    ).toEqual(["effort", "fastMode"]);
  });
});

describe("provider catalog scoping", () => {
  const cursor = modelOption("composer-2");
  const claude = modelOption("fable-5");
  const cursorGroup = {
    providerKey: "cursor",
    providerLabel: "Cursor",
    models: [{ ...cursor, providerKey: "cursor", providerLabel: "Cursor" }],
  };
  const claudeGroup = {
    providerKey: "claude",
    providerLabel: "Claude",
    models: [
      {
        ...claude,
        providerKey: "claude",
        providerLabel: "Claude",
        selection: { ...claude.selection, instanceId: ProviderInstanceId.make("claude") },
      },
    ],
  };

  it("defaults a multi-provider catalog to the selected provider", () => {
    expect(
      initialProviderFilter({
        providerGroups: [claudeGroup, cursorGroup],
        selectedModel: cursorGroup.models[0]?.selection ?? null,
      }),
    ).toBe("cursor");
  });

  it("does not chip-filter a single-provider catalog", () => {
    expect(
      initialProviderFilter({
        providerGroups: [cursorGroup],
        selectedModel: cursorGroup.models[0]?.selection ?? null,
      }),
    ).toBeNull();
  });

  it("clears the provider chip while searching so matches in other catalogs appear", () => {
    expect(effectiveProviderFilter({ providerFilter: "cursor", searchQuery: "fable" })).toBeNull();
    expect(effectiveProviderFilter({ providerFilter: "cursor", searchQuery: "   " })).toBe(
      "cursor",
    );
  });
});

describe("threadSettingsSheetPageForRoute", () => {
  it("maps the inner picker routes and ignores choice pages", () => {
    expect(threadSettingsSheetPageForRoute("ThreadSettingsHome")).toBe("home");
    expect(threadSettingsSheetPageForRoute("ThreadSettingsCatalog")).toBe("catalog");
    expect(threadSettingsSheetPageForRoute("ThreadSettingsChoice")).toBeNull();
  });
});

describe("presentedSettingsSheetPage", () => {
  it("keeps catalog only on a live re-present of the same owner", () => {
    expect(
      presentedSettingsSheetPage({
        preservePage: true,
        currentOwnerId: "thread-1",
        nextOwnerId: "thread-1",
        currentPage: "catalog",
        requestedPage: "home",
      }),
    ).toBe("catalog");
    expect(
      presentedSettingsSheetPage({
        preservePage: false,
        currentOwnerId: "thread-1",
        nextOwnerId: "thread-1",
        currentPage: "catalog",
        requestedPage: "home",
      }),
    ).toBe("home");
    expect(
      presentedSettingsSheetPage({
        preservePage: true,
        currentOwnerId: "thread-1",
        nextOwnerId: "thread-2",
        currentPage: "catalog",
        requestedPage: "home",
      }),
    ).toBe("home");
  });
});
