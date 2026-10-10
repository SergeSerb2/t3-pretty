import { ProviderDriverKind } from "@t3tools/contracts";
import { grokClient } from "@t3tools/provider-grok/client";
import { describe, expect, it } from "vite-plus/test";

import * as Icons from "../Icons";
import { getDisplayModelName, getProviderRowLabel, PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";

describe("provider icon mappings", () => {
  it("maps Grok and Grok Bot to the provider-package glyph after Icons dropped GrokIcon", () => {
    expect("GrokIcon" in Icons).toBe(false);
    expect(grokClient.icon).toBeDefined();

    const grokIcon = PROVIDER_ICON_BY_PROVIDER[ProviderDriverKind.make("grok")];
    const grokBotIcon = PROVIDER_ICON_BY_PROVIDER[ProviderDriverKind.make("grokBot")];
    expect(grokIcon).toEqual(expect.any(Function));
    expect(grokBotIcon).toBe(grokIcon);
  });
});

describe("getProviderRowLabel", () => {
  it("shows a sub-provider named after its provider on its own", () => {
    expect(getProviderRowLabel("OpenCode", "OpenCode Zen")).toBe("OpenCode Zen");
    expect(getProviderRowLabel("OpenCode", "OpenCode Go")).toBe("OpenCode Go");
  });

  it("keeps a provider id that merely starts like the provider name", () => {
    expect(getProviderRowLabel("OpenCode", "opencode-go")).toBe("OpenCode · opencode-go");
  });

  it("joins a sub-provider that names something else", () => {
    expect(getProviderRowLabel("OpenCode", "GitHub Copilot")).toBe("OpenCode · GitHub Copilot");
  });

  it("keeps the provider name when a model has no sub-provider", () => {
    expect(getProviderRowLabel("Claude", undefined)).toBe("Claude");
  });
});

describe("getDisplayModelName", () => {
  it("drops a leading sub-provider qualifier from the model name", () => {
    expect(
      getDisplayModelName({
        slug: "a/b",
        name: "OpenCode Zen: Step 5",
        subProvider: "OpenCode Zen",
      }),
    ).toBe("Step 5");
  });
});
