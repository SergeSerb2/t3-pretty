import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveRuntimeModeOption, runtimeModeOptionsForProvider } from "./runtimeModeOptions";

describe("runtimeModeOptionsForProvider", () => {
  it("offers the generic mode list for every provider", () => {
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
});

describe("resolveRuntimeModeOption", () => {
  it("keeps generic labels for other providers", () => {
    expect(resolveRuntimeModeOption(ProviderDriverKind.make("codex"), "full-access").label).toBe(
      "Full access",
    );
    expect(
      resolveRuntimeModeOption(ProviderDriverKind.make("codex"), "approval-required").label,
    ).toBe("Supervised");
  });
});
