import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ModelCapabilities } from "@t3tools/contracts";

import {
  buildProviderOptionSelectionsFromDescriptors,
  createModelCapabilities,
  createModelSelection,
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
  getProviderOptionBooleanSelectionValue,
  getProviderOptionStringSelectionValue,
  normalizeCustomModelSlug,
  normalizeModelSlug,
  reasoningEffortOptionLabel,
} from "./model.ts";

const codexCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "xhigh", label: "Extra High" },
        { id: "high", label: "High", isDefault: true },
      ],
      currentValue: "high",
    },
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    },
  ],
});

const claudeCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
        { id: "ultrathink", label: "Ultrathink" },
      ],
      currentValue: "high",
      promptInjectedValues: ["ultrathink"],
    },
    {
      id: "contextWindow",
      label: "Context Window",
      type: "select",
      options: [
        { id: "200k", label: "200k" },
        { id: "1m", label: "1M", isDefault: true },
      ],
      currentValue: "1m",
    },
  ],
});

describe("descriptor helpers", () => {
  it("applies selection values to capability descriptors", () => {
    expect(
      getProviderOptionDescriptors({
        caps: claudeCaps,
        selections: [
          { id: "effort", value: "medium" },
          { id: "contextWindow", value: "200k" },
        ],
      }),
    ).toEqual([
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "medium", label: "Medium effort" },
          { id: "high", label: "High effort", isDefault: true },
          { id: "ultrathink", label: "Ultrathink" },
        ],
        currentValue: "medium",
        promptInjectedValues: ["ultrathink"],
      },
      {
        id: "contextWindow",
        label: "Context Window",
        type: "select",
        options: [
          { id: "200k", label: "200k" },
          { id: "1m", label: "1M", isDefault: true },
        ],
        currentValue: "200k",
      },
    ]);
  });

  it("standardizes reasoning effort option labels across providers", () => {
    const kimiCaps: ModelCapabilities = createModelCapabilities({
      optionDescriptors: [
        {
          id: "thinking",
          label: "Thinking",
          type: "select",
          options: [
            { id: "low", label: "Thinking Low" },
            { id: "high", label: "Thinking High", isDefault: true },
            { id: "max", label: "Thinking Max" },
          ],
        },
      ],
    });

    const [descriptor] = getProviderOptionDescriptors({ caps: kimiCaps });
    expect(
      descriptor?.type === "select" && descriptor.options.map((option) => option.label),
    ).toEqual(["Low effort", "High effort", "Max effort"]);

    expect(reasoningEffortOptionLabel("xhigh")).toBe("Extra high effort");
    expect(reasoningEffortOptionLabel("none")).toBe("None");
    expect(reasoningEffortOptionLabel("superhigh")).toBe("Superhigh effort");
    expect(reasoningEffortOptionLabel("auto", "Auto")).toBe("Auto");
    expect(reasoningEffortOptionLabel("", "Custom")).toBe("Custom");
  });

  it("standardizes labels for hyphenated reasoning effort select ids", () => {
    const caps: ModelCapabilities = createModelCapabilities({
      optionDescriptors: [
        {
          id: "reasoning-effort",
          label: "Reasoning Effort",
          type: "select",
          options: [{ id: "high", label: "Thinking High" }],
        },
      ],
    });

    const [descriptor] = getProviderOptionDescriptors({ caps });
    expect(
      descriptor?.type === "select" && descriptor.options.map((option) => option.label),
    ).toEqual(["High effort"]);
  });

  it("standardizes labels for mixed-case reasoning effort select ids", () => {
    const caps: ModelCapabilities = createModelCapabilities({
      optionDescriptors: [
        {
          id: "ReasoningEffort",
          label: "Reasoning Effort",
          type: "select",
          options: [
            { id: "low", label: "Low" },
            { id: "", label: "Provider default" },
          ],
        },
      ],
    });

    const [descriptor] = getProviderOptionDescriptors({ caps });
    expect(
      descriptor?.type === "select" && descriptor.options.map((option) => option.label),
    ).toEqual(["Low effort", "Provider default"]);
  });

  it("builds wire-format option selections from descriptors", () => {
    const descriptors = getProviderOptionDescriptors({
      caps: codexCaps,
      selections: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ],
    });

    expect(buildProviderOptionSelectionsFromDescriptors(descriptors)).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ]);
  });

  it("stores option selection arrays in model selections", () => {
    expect(
      createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ],
    });
  });

  it("reads typed option selection values", () => {
    const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ]);

    expect(getProviderOptionStringSelectionValue(selection.options, "reasoningEffort")).toBe(
      "high",
    );
    expect(getProviderOptionStringSelectionValue(selection.options, "fastMode")).toBeUndefined();
    expect(getProviderOptionBooleanSelectionValue(selection.options, "fastMode")).toBe(true);
    expect(
      getProviderOptionBooleanSelectionValue(selection.options, "reasoningEffort"),
    ).toBeUndefined();
    expect(getModelSelectionStringOptionValue(selection, "reasoningEffort")).toBe("high");
    expect(getModelSelectionBooleanOptionValue(selection, "fastMode")).toBe(true);
  });
});

describe("model slug normalization", () => {
  it("preserves exact custom slugs instead of expanding provider aliases", () => {
    const claude = ProviderDriverKind.make("claudeAgent");

    expect(normalizeModelSlug("opus", claude)).toBe("claude-opus-5");
    expect(normalizeCustomModelSlug(" opus ")).toBe("opus");
  });
});
