import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveRuntimeModeOption, runtimeModeOptionsForProvider } from "./runtimeModeOptions";

describe("runtimeModeOptionsForProvider", () => {
  it("offers the generic mode list for non-Kimi providers", () => {
    expect(runtimeModeOptionsForProvider(ProviderDriverKind.make("codex"))).toEqual([
      "approval-required",
      "auto-accept-edits",
      "auto",
      "full-access",
    ]);
  });

  it("replaces full access with Auto and Yolo for Kimi", () => {
    expect(runtimeModeOptionsForProvider(ProviderDriverKind.make("kimi"))).toEqual([
      "approval-required",
      "full-access",
      "yolo",
    ]);
  });
});

describe("resolveRuntimeModeOption", () => {
  it("labels Kimi full access as Auto and yolo as Yolo", () => {
    expect(resolveRuntimeModeOption(ProviderDriverKind.make("kimi"), "full-access").label).toBe(
      "Auto",
    );
    expect(resolveRuntimeModeOption(ProviderDriverKind.make("kimi"), "yolo").label).toBe("Yolo");
  });

  it("keeps generic labels for other providers", () => {
    expect(resolveRuntimeModeOption(ProviderDriverKind.make("codex"), "full-access").label).toBe(
      "Full access",
    );
    expect(
      resolveRuntimeModeOption(ProviderDriverKind.make("codex"), "approval-required").label,
    ).toBe("Supervised");
  });
});
