import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  RUNTIME_MODE_CHOICES,
  runtimeModeChoicesForProvider,
  selectableChoices,
} from "./thread-settings-options";

const effortDescriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
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

describe("selectableChoices", () => {
  it("hides prompt-injected and workflow-trigger choices, keeping declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("runtimeModeChoicesForProvider", () => {
  it("gives every choice a row label, a summary shortLabel, and a description", () => {
    for (const choice of [
      ...runtimeModeChoicesForProvider(null),
      ...runtimeModeChoicesForProvider("kimi"),
    ]) {
      expect(choice.label).toBeTruthy();
      expect(choice.shortLabel).toBeTruthy();
      expect(choice.description).toBeTruthy();
    }
  });

  it("offers Yolo and Full access for Kimi in ascending order of access", () => {
    expect(
      runtimeModeChoicesForProvider("kimi").map((choice) => [choice.mode, choice.label]),
    ).toEqual([
      ["approval-required", "Approve actions"],
      ["yolo", "Yolo"],
      ["full-access", "Full access"],
    ]);
  });

  it("falls back to the generic modes for other providers", () => {
    expect(runtimeModeChoicesForProvider("codex")).toBe(RUNTIME_MODE_CHOICES);
    expect(runtimeModeChoicesForProvider(undefined)).toBe(RUNTIME_MODE_CHOICES);
  });
});
