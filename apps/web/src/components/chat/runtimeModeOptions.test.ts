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
    expect(runtimeModeOptionsForProvider(ProviderDriverKind.make("grok"))).toEqual([
      "approval-required",
      "auto-accept-edits",
      "auto",
      "full-access",
    ]);
  });

  it("offers Yolo and Full access for Kimi in ascending order of access", () => {
    expect(runtimeModeOptionsForProvider(ProviderDriverKind.make("kimi"))).toEqual([
      "approval-required",
      "yolo",
      "full-access",
    ]);
  });
});

describe("resolveRuntimeModeOption", () => {
  it("labels Kimi yolo as Yolo and full access as Full access", () => {
    expect(resolveRuntimeModeOption(ProviderDriverKind.make("kimi"), "yolo").label).toBe("Yolo");
    expect(resolveRuntimeModeOption(ProviderDriverKind.make("kimi"), "full-access").label).toBe(
      "Full access",
    );
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
