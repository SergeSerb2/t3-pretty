import { describe, expect, it } from "vite-plus/test";

import { withNativeGlassHeaderItem } from "./native-glass-header-items";

describe("withNativeGlassHeaderItem", () => {
  it("does not request shared glass backgrounds while the native kill-switch is down", () => {
    expect(
      withNativeGlassHeaderItem({
        type: "button",
      }),
    ).toMatchObject({
      glassEffect: false,
      hidesSharedBackground: false,
      sharesBackground: false,
    });
  });

  it("keeps an explicit sharesBackground request", () => {
    expect(
      withNativeGlassHeaderItem(
        {
          type: "button",
        },
        { sharesBackground: true },
      ).sharesBackground,
    ).toBe(true);
  });
});
