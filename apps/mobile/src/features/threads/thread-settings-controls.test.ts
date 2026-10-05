import type { ProviderOptionDescriptor, ProviderOptionSelection } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";

import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import {
  buildThreadSettingsControlLayout,
  fitsSegmentedControl,
  shortEffortLabel,
} from "./thread-settings-controls";

const claudeOptions: ReadonlyArray<ProviderOptionDescriptor> = [
  {
    id: "effort",
    label: "Reasoning",
    type: "select",
    options: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium", isDefault: true },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
      { id: "ultracode", label: "Ultracode" },
      { id: "ultrathink", label: "Ultrathink" },
    ],
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
  },
  { id: "fastMode", label: "Fast Mode", type: "boolean" },
];

const codexOptions: ReadonlyArray<ProviderOptionDescriptor> = [
  {
    id: "reasoningEffort",
    label: "Reasoning",
    type: "select",
    options: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium", isDefault: true },
      { id: "high", label: "High" },
    ],
    currentValue: "medium",
  },
  {
    id: "serviceTier",
    label: "Service Tier",
    type: "select",
    options: [
      { id: "default", label: "Standard", isDefault: true },
      { id: "priority", label: "Fast" },
      { id: "flex", label: "Flex" },
    ],
    currentValue: "default",
  },
];

function layoutFor(
  optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>,
  selections: ReadonlyArray<ProviderOptionSelection> = [],
) {
  return buildThreadSettingsControlLayout(
    resolveProviderOptionDescriptors({
      capabilities: createModelCapabilities({ optionDescriptors }),
      selections,
    }),
  );
}

describe("buildThreadSettingsControlLayout", () => {
  it("gives Claude an effort meter, a fast-mode speed control, and keeps context window generic", () => {
    const layout = layoutFor(claudeOptions, [
      { id: "effort", value: "high" },
      { id: "fastMode", value: true },
    ]);

    expect(layout.reasoning?.levels.map((level) => level.shortLabel)).toEqual([
      "Low",
      "Medium",
      "High",
      "X-High",
      "Max",
    ]);
    expect(layout.reasoning?.selectedIndex).toBe(2);
    expect(layout.reasoning?.valueLabel).toBe("High effort");
    expect(layout.speed).toMatchObject({ id: "fastMode", selectedIndex: 1, boosted: true });
    expect(layout.speed?.choices.map((choice) => choice.value)).toEqual([false, true]);
    expect(layout.extras.map((descriptor) => descriptor.id)).toEqual(["contextWindow"]);
  });

  it("reads Codex's service tier as speed and only boosts fast tiers", () => {
    expect(layoutFor(codexOptions).speed).toMatchObject({ selectedIndex: 0, boosted: false });
    expect(layoutFor(codexOptions, [{ id: "serviceTier", value: "priority" }]).speed).toMatchObject(
      { selectedIndex: 1, boosted: true },
    );
    expect(layoutFor(codexOptions, [{ id: "serviceTier", value: "flex" }]).speed).toMatchObject({
      selectedIndex: 2,
      boosted: false,
    });
  });

  it("still names a level set elsewhere that the meter does not offer", () => {
    const reasoning = layoutFor(claudeOptions, [{ id: "effort", value: "ultracode" }]).reasoning;

    expect(reasoning?.selectedIndex).toBe(-1);
    expect(reasoning?.valueLabel).toBe("Ultracode");
  });

  it("leaves non-ordinal selects such as OpenCode variants to the generic controls", () => {
    const layout = layoutFor([
      {
        id: "variant",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
      },
    ]);

    expect(layout.reasoning).toBeNull();
    expect(layout.extras.map((descriptor) => descriptor.id)).toEqual(["variant"]);
  });

  it("keeps a lone service tier generic instead of a one-stop speed control", () => {
    const layout = layoutFor([
      {
        id: "serviceTier",
        label: "Service Tier",
        type: "select",
        options: [{ id: "default", label: "Standard" }],
      },
    ]);

    expect(layout.speed).toBeNull();
    expect(layout.extras).toHaveLength(1);
  });
});

describe("shortEffortLabel", () => {
  it("drops the effort suffix and abbreviates the widest levels", () => {
    expect(shortEffortLabel("Medium effort")).toBe("Medium");
    expect(shortEffortLabel("Extra high effort")).toBe("X-High");
    expect(shortEffortLabel("Minimal effort")).toBe("Min");
    expect(shortEffortLabel("None")).toBe("None");
  });
});

describe("fitsSegmentedControl", () => {
  it("segments short two-to-four choice selects and wraps the rest", () => {
    expect(
      fitsSegmentedControl([
        { id: "200k", label: "200k" },
        { id: "1m", label: "1M" },
      ]),
    ).toBe(true);
    expect(fitsSegmentedControl([{ id: "only", label: "Only" }])).toBe(false);
    expect(
      fitsSegmentedControl([
        { id: "build", label: "Build" },
        { id: "plan", label: "A much longer agent name" },
      ]),
    ).toBe(false);
  });
});
