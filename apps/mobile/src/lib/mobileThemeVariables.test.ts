import { describe, expect, it } from "vite-plus/test";

import { readDefaultMobileThemeVariables } from "./mobileTheme.test-support";
import {
  flattenThemeColor,
  getMobileThemeVariables,
  MOBILE_THEME_IDS,
  themeColorWithAlpha,
} from "./mobileTheme";
import { getMobileThemeRuntimeVariables } from "./mobileThemeVariables";

function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe("mobile theme runtime variables", () => {
  describe.each(["t3-code", "material-you"] as const)("default %s frame", (themeId) => {
    it.each([
      ["android", "light"],
      ["android", "dark"],
      ["ios", "light"],
      ["ios", "dark"],
    ] as const)("keeps %s %s header text readable", (platform, appearance) => {
      const variables = getMobileThemeRuntimeVariables(themeId, appearance, platform);
      const frame = flattenThemeColor(variables["--color-header"], variables["--color-screen"]);
      for (const role of [
        "--color-header-foreground",
        "--color-foreground-muted",
        "--color-foreground-secondary",
      ] as const) {
        expect(contrastRatio(variables[role], frame), role).toBeGreaterThanOrEqual(4.5);
      }
      if (platform === "ios") {
        const drawer = flattenThemeColor(variables["--color-drawer"], variables["--color-screen"]);
        for (const role of [
          "--color-drawer-foreground",
          "--color-drawer-foreground-muted",
        ] as const) {
          expect(contrastRatio(variables[role], drawer), role).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  });

  it("matches the standard base palette to the generated stylesheet", () => {
    const lightRuntime = getMobileThemeRuntimeVariables("t3-code", "light", "web");
    const darkRuntime = getMobileThemeRuntimeVariables("t3-code", "dark", "web");
    const lightSheet = readDefaultMobileThemeVariables("light");
    const darkSheet = readDefaultMobileThemeVariables("dark");

    expect(Object.keys(lightRuntime).sort()).toEqual(Object.keys(lightSheet).sort());
    expect(Object.keys(darkRuntime).sort()).toEqual(Object.keys(darkSheet).sort());
    expect(lightRuntime["--color-screen"]).toBe("#f4f6f4");
    expect(darkRuntime["--color-screen"]).toBe("#0e1110");
    expect(lightSheet["--color-screen"]).toBe("#fcfcfc");
    expect(darkSheet["--color-screen"]).toBe("#0a0a0a");
  });

  it("uses the same shared palette source as generated custom themes", () => {
    expect(getMobileThemeRuntimeVariables("ocean", "light", "ios")).toEqual(
      getMobileThemeVariables("ocean", "light"),
    );
    expect(getMobileThemeRuntimeVariables("iris", "dark", "ios")).toEqual(
      getMobileThemeVariables("iris", "dark"),
    );
  });

  it.each(MOBILE_THEME_IDS)(
    "uses a screen-colored %s sidebar beneath an opaque Android frame",
    (themeId) => {
      for (const appearance of ["light", "dark"] as const) {
        const base =
          themeId === "t3-code" || themeId === "material-you"
            ? getMobileThemeRuntimeVariables(themeId, appearance, "web")
            : getMobileThemeVariables(themeId, appearance);
        const android = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        expect(android).toEqual({
          ...base,
          "--color-header":
            themeId === "t3-code" || themeId === "material-you"
              ? appearance === "light"
                ? "#e8ede9"
                : "#1c2420"
              : themeColorWithAlpha(base["--color-drawer"], 1),
          "--color-header-foreground": base["--color-drawer-foreground"],
          "--color-drawer": base["--color-screen"],
        });
        expect(android["--color-header"]).toMatch(
          themeId === "t3-code" || themeId === "material-you"
            ? /^#[\da-f]{6}$/
            : /^rgba\(\d+, \d+, \d+, 1\)$/,
        );
      }
    },
  );

  it.each(["t3-code", "material-you"] as const)(
    "keeps the %s default Material frame distinct in both appearances",
    (themeId) => {
      for (const appearance of ["light", "dark"] as const) {
        const variables = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        expect(variables["--color-header"]).toBe(appearance === "light" ? "#e8ede9" : "#1c2420");
        const distinctPanes = (
          ["--color-screen", "--color-sheet-solid", "--color-drawer"] as const
        ).filter(
          (pane) =>
            variables["--color-header"] !==
            flattenThemeColor(variables[pane], variables["--color-screen"]),
        );
        expect(distinctPanes.length).toBeGreaterThan(0);
      }
    },
  );

  it.each(["t3-code", "material-you"] as const)(
    "adapts %s iPad chrome without reversing the dark desktop hierarchy",
    (themeId) => {
      for (const appearance of ["light", "dark"] as const) {
        const ios = getMobileThemeRuntimeVariables(themeId, appearance, "ios");
        const android = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        const expectedAndroidFrame = appearance === "light" ? "#e8ede9" : "#1c2420";
        if (appearance === "light") {
          expect(ios["--color-drawer"]).toBe(android["--color-header"]);
          expect(ios["--color-header"]).toBe(android["--color-header"]);
          expect(ios["--color-header-foreground"]).toBe(ios["--color-drawer-foreground"]);
        } else {
          expect(ios).toEqual(getMobileThemeRuntimeVariables(themeId, appearance, "web"));
          expect(android["--color-header"]).toBe(expectedAndroidFrame);
          expect(android["--color-header"]).not.toBe(
            themeColorWithAlpha(android["--color-sheet-solid"], 1),
          );
        }
        expect(ios["--color-thread-hover"]).not.toBe(ios["--color-drawer"]);
        expect(ios["--color-thread-hover"]).not.toBe(ios["--color-thread-selected"]);
        for (const role of [
          "--color-screen",
          "--color-thread-canvas",
          "--color-card",
          "--color-composer-surface",
          "--color-grouped-card",
        ] as const) {
          expect(ios[role]).toBe(android[role]);
        }
      }
    },
  );
});
