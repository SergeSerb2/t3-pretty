import { ProviderDriverKind } from "@t3tools/contracts";
import { grokClient } from "@t3tools/provider-grok/client";
import { describe, expect, it } from "vite-plus/test";

import * as Icons from "../Icons";
import { PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";

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
