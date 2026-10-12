import { describe, expect, it } from "vite-plus/test";

import { readDefaultMobileThemeVariables } from "./mobileTheme.test-support";
import { getMobileThemeVariables, MOBILE_THEME_IDS, themeColorWithAlpha } from "./mobileTheme";
import { getMobileThemeRuntimeVariables } from "./mobileThemeVariables";

describe("mobile theme runtime variables", () => {
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
          "--color-header": themeColorWithAlpha(
            base[
              themeId === "t3-code" || themeId === "material-you"
                ? "--color-row-hover"
                : "--color-drawer"
            ],
            1,
          ),
          "--color-header-foreground": base["--color-drawer-foreground"],
          "--color-drawer": base["--color-screen"],
        });
        expect(android["--color-header"]).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
      }
    },
  );

  it.each(["t3-code", "material-you"] as const)(
    "keeps the %s default Material frame distinct in both appearances",
    (themeId) => {
      for (const appearance of ["light", "dark"] as const) {
        const web = getMobileThemeRuntimeVariables(themeId, appearance, "web");
        const variables = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        expect(variables["--color-header"]).toBe(themeColorWithAlpha(web["--color-row-hover"], 1));
        expect(variables["--color-header"]).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
        const distinctPanes = (
          ["--color-screen", "--color-sheet-solid", "--color-drawer"] as const
        ).filter((pane) => variables["--color-header"] !== themeColorWithAlpha(variables[pane], 1));
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
        if (appearance === "light") {
          expect(ios["--color-drawer"]).toBe(android["--color-header"]);
          expect(ios["--color-header"]).toBe(android["--color-header"]);
          expect(ios["--color-header-foreground"]).toBe(ios["--color-drawer-foreground"]);
        } else {
          expect(ios).toEqual(getMobileThemeRuntimeVariables(themeId, appearance, "web"));
          expect(android["--color-header"]).toBe(
            themeColorWithAlpha(ios["--color-row-hover"], 1),
          );
          expect(android["--color-header"]).not.toBe(
            themeColorWithAlpha(android["--color-sheet-solid"], 1),
          );
        }
        expect(themeColorWithAlpha(ios["--color-thread-hover"], 1)).not.toBe(
          themeColorWithAlpha(ios["--color-drawer"], 1),
        );
        expect(themeColorWithAlpha(ios["--color-thread-hover"], 1)).not.toBe(
          themeColorWithAlpha(ios["--color-thread-selected"], 1),
        );
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
