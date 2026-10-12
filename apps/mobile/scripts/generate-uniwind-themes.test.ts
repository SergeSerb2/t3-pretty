import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  customThemeNames,
  getGeneratedUniwindThemeOutputs,
  renderDefaultThemeVariablesJSON,
  renderUniwindThemesCSS,
} from "./generate-uniwind-themes.mts";
import { readDefaultMobileThemeVariables } from "../src/lib/mobileTheme.test-support";

describe("generate mobile Uniwind themes", () => {
  it("keeps the committed outputs current", () => {
    const staleOutputs = getGeneratedUniwindThemeOutputs()
      .filter(
        ([filename, contents]) =>
          !NodeFS.existsSync(filename) || NodeFS.readFileSync(filename, "utf8") !== contents,
      )
      .map(([filename]) => NodePath.relative(import.meta.dirname, filename));

    expect(
      staleOutputs,
      "Run `vp run --filter @t3tools/mobile generate` and commit the generated outputs.",
    ).toEqual([]);
  });

  it("registers every custom palette for both appearances", () => {
    expect(customThemeNames).toEqual([
      "t3-chat-light",
      "t3-chat-dark",
      "grove-light",
      "grove-dark",
      "ocean-light",
      "ocean-dark",
      "ember-light",
      "ember-dark",
      "iris-light",
      "iris-dark",
    ]);

    const stylesheet = renderUniwindThemesCSS();
    for (const themeName of customThemeNames) {
      expect(stylesheet.match(new RegExp(`@variant ${themeName} \\{`, "gu"))).toHaveLength(1);
    }
  });

  it("keeps the default runtime bridge and generated CSS on the same palette", () => {
    const variables = JSON.parse(renderDefaultThemeVariablesJSON());
    const lightSheet = readDefaultMobileThemeVariables("light");
    const darkSheet = readDefaultMobileThemeVariables("dark");

    // JS overlay / native JSON stay Pretty; Uniwind default variants stay parent t3-code.
    expect(Object.keys(variables.light).sort()).toEqual(Object.keys(lightSheet).sort());
    expect(Object.keys(variables.dark).sort()).toEqual(Object.keys(darkSheet).sort());
    expect(variables.light["--color-screen"]).toBe("#f4f6f4");
    expect(variables.light["--color-drawer"]).toBe("rgba(250, 252, 250, 0.99)");
    expect(variables.dark["--color-screen"]).toBe("#0e1110");
    expect(variables.dark["--color-drawer"]).toBe("rgba(12, 16, 14, 0.99)");
    expect(lightSheet["--color-screen"]).toBe("#fcfcfc");
    expect(darkSheet["--color-screen"]).toBe("#0a0a0a");
    expect(Object.keys(variables.light)).toEqual(Object.keys(variables.dark));
  });
  it("gives every theme the same variables and a fixed Clerk palette for its appearance", () => {
    const css =
      NodeFS.readFileSync(NodePath.resolve(import.meta.dirname, "../global.css"), "utf8") +
      renderUniwindThemesCSS();
    const themes = new Map<string, Map<string, string>>(
      ["light", "dark", ...customThemeNames].map((name) => [name, new Map()]),
    );
    for (const [, name, body] of css.matchAll(/@variant ([\w-]+) \{([^}]+)\}/gu)) {
      const variables = themes.get(name!);
      for (const [, variable, value] of body!.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) {
        variables?.set(variable!, value!.trim().toLowerCase());
      }
    }

    const lightVariables = themes.get("light")!;
    for (const [name, variables] of themes) {
      expect([...variables.keys()].sort(), name).toEqual([...lightVariables.keys()].sort());
      const isDark = name === "dark" || name.endsWith("-dark");
      expect(
        Object.fromEntries(
          [...variables].filter(([variable]) => variable.startsWith("--color-clerk-")),
        ),
        name,
      ).toEqual({
        "--color-clerk-page": isDark ? "#0a0a0a" : "#fcfcfc",
        "--color-clerk-foreground": isDark ? "#f5f5f5" : "#27272a",
        "--color-clerk-foreground-muted": isDark ? "#818181" : "#71717b",
        "--color-clerk-border": isDark ? "#191919" : "#e4e4e7",
        "--color-clerk-danger": isDark ? "#ff6467" : "#c10007",
      });
    }
  });
});
