import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type ProviderOptionDescriptor } from "@t3tools/contracts";

import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import {
  INLINE_MODEL_LIMIT,
  buildThreadSettingsPickerModel,
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

  it("offers Kimi Auto and Yolo instead of Full access", () => {
    const kimiModels = [
      modelOption("k3", { providerKey: "kimi", providerLabel: "Kimi", providerDriver: "kimi" }),
    ];
    const picker = buildThreadSettingsPickerModel({
      providerGroups: [group(kimiModels)],
      selectedModel: kimiModels[0]?.selection ?? null,
      optionDescriptors: [],
      runtimeMode: "full-access",
    });

    expect(picker.runtimeChoices.map((choice) => choice.label)).toEqual([
      "Approve actions",
      "Auto",
      "Yolo",
    ]);
    expect(picker.runtimeChoices.find((choice) => choice.selected)?.shortLabel).toBe("Auto");
  });
});
