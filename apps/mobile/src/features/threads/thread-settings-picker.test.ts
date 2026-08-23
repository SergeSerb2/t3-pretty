import { describe, expect, it } from "vite-plus/test";

import {
  ProviderInstanceId,
  defaultRuntimeModeForProviderDriver,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";

import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import {
  INLINE_MODEL_LIMIT,
  buildThreadSettingsPickerModel,
  filterPickerModelList,
  shouldInlinePickerModels,
  visiblePickerModels,
} from "./thread-settings-picker";

function modelOption(
  model: string,
  overrides: Partial<
    Pick<ModelOption, "isDefault" | "isLegacy" | "providerKey" | "providerLabel" | "providerDriver">
  > = {},
): ModelOption {
  const providerKey = overrides.providerKey ?? "codex";
  return {
    key: `${providerKey}:${model}`,
    label: model,
    subtitle: providerKey,
    providerKey,
    providerLabel: overrides.providerLabel ?? (providerKey === "codex" ? "Codex" : "Claude"),
    providerDriver: overrides.providerDriver ?? (providerKey === "codex" ? "codex" : "claudeAgent"),
    isDefault: overrides.isDefault ?? false,
    isLegacy: overrides.isLegacy ?? false,
    capabilities: null,
    selection: {
      instanceId: ProviderInstanceId.make(providerKey),
      model,
      options: [],
    },
  };
}

function group(models: ReadonlyArray<ModelOption>): ProviderGroup {
  const first = models[0];
  if (!first) {
    throw new Error("group requires at least one model");
  }
  return {
    providerKey: first.providerKey,
    providerLabel: first.providerLabel,
    models,
  };
}

const effortDescriptor: ProviderOptionDescriptor = {
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

const serviceTierDescriptor: ProviderOptionDescriptor = {
  id: "serviceTier",
  label: "Service Tier",
  type: "select",
  options: [
    { id: "default", label: "Default", isDefault: true },
    { id: "priority", label: "Priority" },
  ],
  currentValue: "default",
};

const fastModeDescriptor: ProviderOptionDescriptor = {
  id: "fastMode",
  label: "Fast mode",
  type: "boolean",
  currentValue: false,
};

function baseInput() {
  const models = [
    modelOption("gpt-current", { isDefault: true }),
    modelOption("gpt-next"),
    modelOption("gpt-old", { isLegacy: true }),
  ];
  return {
    providerGroups: [group(models)],
    selectedModel: models[0]?.selection ?? null,
    optionDescriptors: [effortDescriptor, serviceTierDescriptor, fastModeDescriptor],
    runtimeMode: "auto" as const,
  };
}

describe("shouldInlinePickerModels", () => {
  it("inlines a short single-provider catalog", () => {
    expect(shouldInlinePickerModels({ providerGroupCount: 1, modelCount: 4 })).toBe(true);
    expect(
      shouldInlinePickerModels({ providerGroupCount: 1, modelCount: INLINE_MODEL_LIMIT }),
    ).toBe(true);
  });

  it("sends long catalogs and multi-provider lists to the sheet", () => {
    expect(
      shouldInlinePickerModels({ providerGroupCount: 1, modelCount: INLINE_MODEL_LIMIT + 1 }),
    ).toBe(false);
    expect(shouldInlinePickerModels({ providerGroupCount: 2, modelCount: 3 })).toBe(false);
    expect(shouldInlinePickerModels({ providerGroupCount: 1, modelCount: 0 })).toBe(false);
  });
});

describe("visiblePickerModels", () => {
  it("hides unselected legacy models", () => {
    const input = baseInput();
    expect(visiblePickerModels(input).map((model) => model.label)).toEqual([
      "gpt-current",
      "gpt-next",
    ]);
  });

  it("keeps a selected legacy model visible", () => {
    const input = baseInput();
    const legacy = input.providerGroups[0]?.models.find((model) => model.isLegacy);
    expect(
      visiblePickerModels({
        ...input,
        selectedModel: legacy?.selection ?? null,
      }).map((model) => model.label),
    ).toEqual(["gpt-current", "gpt-next", "gpt-old"]);
  });
});

describe("buildThreadSettingsPickerModel", () => {
  it("surfaces the current model before options, never a long catalog", () => {
    const picker = buildThreadSettingsPickerModel(baseInput());

    expect(picker.modelLabel).toBe("gpt-current");
    expect(picker.providerLabel).toBe("Codex");
    expect(picker.selectSections.map((section) => section.label)).toEqual([
      "Reasoning",
      "Service Tier",
    ]);
    expect(picker.booleanSections.map((section) => section.label)).toEqual(["Fast mode"]);
    expect(picker.inlineModels?.map((entry) => entry.option.label)).toEqual([
      "gpt-current",
      "gpt-next",
    ]);
  });

  it("hides prompt-injected and workflow-trigger efforts", () => {
    const picker = buildThreadSettingsPickerModel({
      ...baseInput(),
      optionDescriptors: [{ ...effortDescriptor, currentValue: "ultracode" }],
    });

    const reasoning = picker.selectSections.find((section) => section.id === "effort");
    expect(reasoning?.choices.map((choice) => choice.label)).toEqual(["Low", "Medium", "High"]);
    expect(reasoning?.choices.every((choice) => !choice.selected)).toBe(true);
  });

  it("marks the current select, boolean, and runtime values", () => {
    const picker = buildThreadSettingsPickerModel(baseInput());

    expect(
      picker.selectSections
        .find((section) => section.id === "effort")
        ?.choices.find((choice) => choice.selected)?.label,
    ).toBe("High");
    expect(picker.booleanSections[0]?.value).toBe(false);
    expect(picker.runtimeChoices.find((choice) => choice.selected)?.label).toBe("Auto");
  });

  it("does not inline a Cursor-sized catalog", () => {
    const models = Array.from({ length: 20 }, (_, index) =>
      modelOption(`cursor-${index}`, {
        providerKey: "cursor",
        providerLabel: "Cursor",
        providerDriver: "cursor",
      }),
    );
    const picker = buildThreadSettingsPickerModel({
      providerGroups: [group(models)],
      selectedModel: models[0]?.selection ?? null,
      optionDescriptors: [effortDescriptor],
      runtimeMode: "auto",
    });

    expect(picker.modelLabel).toBe("cursor-0");
    expect(picker.inlineModels).toBeNull();
    expect(picker.selectSections[0]?.label).toBe("Reasoning");
  });

  it("offers Kimi Yolo and Full access in ascending order of access", () => {
    const kimiModels = [
      modelOption("k3", { providerKey: "kimi", providerLabel: "Kimi", providerDriver: "kimi" }),
    ];
    const picker = buildThreadSettingsPickerModel({
      providerGroups: [group(kimiModels)],
      selectedModel: kimiModels[0]?.selection ?? null,
      optionDescriptors: [],
      runtimeMode: defaultRuntimeModeForProviderDriver("kimi"),
    });

    expect(picker.runtimeChoices.map((choice) => choice.label)).toEqual([
      "Approve actions",
      "Yolo",
      "Full access",
    ]);
    expect(picker.runtimeChoices.find((choice) => choice.selected)?.shortLabel).toBe("Yolo");
  });

  it("keeps an explicit Kimi Full access pick selected", () => {
    const kimiModels = [
      modelOption("k3", { providerKey: "kimi", providerLabel: "Kimi", providerDriver: "kimi" }),
    ];
    const picker = buildThreadSettingsPickerModel({
      providerGroups: [group(kimiModels)],
      selectedModel: kimiModels[0]?.selection ?? null,
      optionDescriptors: [],
      runtimeMode: "full-access",
    });

    expect(picker.runtimeChoices.find((choice) => choice.selected)?.shortLabel).toBe("Full");
  });

  it("treats carried Kimi yolo as Full access on Grok", () => {
    const grokModels = [
      modelOption("grok-4.6", {
        providerKey: "grok",
        providerLabel: "Grok",
        providerDriver: "grok",
      }),
    ];
    const picker = buildThreadSettingsPickerModel({
      providerGroups: [group(grokModels)],
      selectedModel: grokModels[0]?.selection ?? null,
      optionDescriptors: [],
      runtimeMode: "yolo",
    });

    expect(picker.runtimeChoices.map((choice) => choice.mode)).not.toContain("yolo");
    expect(picker.runtimeChoices.find((choice) => choice.selected)?.mode).toBe("full-access");
  });

  it("does not remap carried yolo when the provider is unknown", () => {
    const picker = buildThreadSettingsPickerModel({
      providerGroups: [],
      selectedModel: {
        instanceId: ProviderInstanceId.make("kimi"),
        model: "k2",
      },
      optionDescriptors: [],
      runtimeMode: "yolo",
    });

    expect(picker.runtimeChoices.find((choice) => choice.selected)).toBeUndefined();
  });
});

describe("buildThreadSettingsPickerModel modelList", () => {
  it("is null when the catalog renders as chips", () => {
    expect(buildThreadSettingsPickerModel(baseInput()).modelList).toBeNull();
  });

  it("lists a Cursor-sized catalog flat, without provider headers", () => {
    const models = Array.from({ length: 20 }, (_, index) =>
      modelOption(`cursor-${index}`, {
        providerKey: "cursor",
        providerLabel: "Cursor",
        providerDriver: "cursor",
      }),
    );
    const picker = buildThreadSettingsPickerModel({
      providerGroups: [group(models)],
      selectedModel: models[1]?.selection ?? null,
      optionDescriptors: [],
      runtimeMode: "auto",
    });

    expect(picker.modelList?.length).toBe(20);
    expect(picker.modelList?.every((entry) => !entry.showProviderHeader)).toBe(true);
    expect(picker.modelList?.find((entry) => entry.selected)?.option.label).toBe("cursor-1");
  });

  it("marks group headers and hides unselected legacy models across providers", () => {
    const codex = [modelOption("gpt-a"), modelOption("gpt-b", { isLegacy: true })];
    const claude = [modelOption("claude-a", { providerKey: "claude" })];
    const picker = buildThreadSettingsPickerModel({
      providerGroups: [group(codex), group(claude)],
      selectedModel: null,
      optionDescriptors: [],
      runtimeMode: "auto",
    });

    expect(picker.modelList?.map((entry) => entry.option.label)).toEqual(["gpt-a", "claude-a"]);
    expect(picker.modelList?.map((entry) => entry.showProviderHeader)).toEqual([true, true]);
    expect(picker.modelList?.map((entry) => entry.providerLabel)).toEqual(["Codex", "Claude"]);
  });
});

describe("filterPickerModelList", () => {
  function twoProviderList() {
    const codex = [modelOption("gpt-a"), modelOption("gpt-b")];
    const claude = [modelOption("claude-a", { providerKey: "claude" })];
    const picker = buildThreadSettingsPickerModel({
      providerGroups: [group(codex), group(claude)],
      selectedModel: null,
      optionDescriptors: [],
      runtimeMode: "auto",
    });
    const list = picker.modelList;
    if (!list) {
      throw new Error("expected a model list for a multi-provider catalog");
    }
    return list;
  }

  it("returns the list untouched for a blank query", () => {
    const list = twoProviderList();
    expect(filterPickerModelList(list, "")).toBe(list);
    expect(filterPickerModelList(list, "   ")).toBe(list);
  });

  it("matches model labels case-insensitively", () => {
    const filtered = filterPickerModelList(twoProviderList(), "GPT");
    expect(filtered.map((entry) => entry.option.label)).toEqual(["gpt-a", "gpt-b"]);
  });

  it("matches provider labels", () => {
    const filtered = filterPickerModelList(twoProviderList(), "claude");
    expect(filtered.map((entry) => entry.option.label)).toEqual(["claude-a"]);
  });

  it("drops headers once one provider remains", () => {
    const filtered = filterPickerModelList(twoProviderList(), "gpt");
    expect(filtered.every((entry) => !entry.showProviderHeader)).toBe(true);
  });

  it("keeps headers on the first row of each remaining provider", () => {
    const filtered = filterPickerModelList(twoProviderList(), "-a");
    expect(filtered.map((entry) => entry.showProviderHeader)).toEqual([true, true]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterPickerModelList(twoProviderList(), "grok")).toEqual([]);
  });
});
