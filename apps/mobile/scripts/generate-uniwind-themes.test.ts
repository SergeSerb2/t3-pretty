import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  customThemeNames,
  getGeneratedUniwindThemeOutputs,
  readClerkThemeVariables,
  readDefaultThemeVariables,
  renderUniwindThemesCSS,
} from "./generate-uniwind-themes.mts";

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

  it("generates the default runtime bridge from the authored CSS", () => {
    const css = NodeFS.readFileSync(NodePath.resolve(import.meta.dirname, "../global.css"), "utf8");
    const variables = readDefaultThemeVariables(css);

    expect(variables.light["--color-screen"]).toBe("#f4f6f4");
    expect(variables.dark["--color-screen"]).toBe("#0e1110");
    expect(Object.keys(variables.light)).toEqual(Object.keys(variables.dark));
  });

  it("keeps custom palettes on the same Uniwind variable set as light and dark", () => {
    const authored = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "../global.css"),
      "utf8",
    );
    const generated = renderUniwindThemesCSS(authored);
    const namesByTheme = new Map<string, Set<string>>();

    for (const stylesheet of [authored, generated]) {
      for (const match of stylesheet.matchAll(/@variant\s+([A-Za-z0-9-]+)\s*\{/gu)) {
        const themeName = match[1]!;
        if (themeName === "android") continue;
        const bodyStart = stylesheet.indexOf("{", match.index);
        const bodyEnd = stylesheet.indexOf("\n    }", bodyStart);
        const names = namesByTheme.get(themeName) ?? new Set<string>();
        for (const [, name] of stylesheet
          .slice(bodyStart, bodyEnd)
          .matchAll(/(--[A-Za-z0-9-]+)\s*:/gu)) {
          names.add(name!);
        }
        namesByTheme.set(themeName, names);
      }
    }

    const expected = namesByTheme.get("light");
    expect(expected?.size).toBeGreaterThan(0);
    for (const [themeName, names] of namesByTheme) {
      expect([...names].sort(), themeName).toEqual([...expected!].sort());
    }
  });

  it("copies the fixed Clerk tokens onto every custom palette", () => {
    const css = NodeFS.readFileSync(NodePath.resolve(import.meta.dirname, "../global.css"), "utf8");
    const clerkVariables = readClerkThemeVariables(css);
    const stylesheet = renderUniwindThemesCSS(css);

    expect(clerkVariables.light["--color-clerk-page"]).toBe("#f2f2f7");
    expect(clerkVariables.dark["--color-clerk-page"]).toBe("#0e0e0e");

    for (const themeName of customThemeNames) {
      const appearance = themeName.endsWith("-dark") ? "dark" : "light";
      const marker = `@variant ${themeName} {`;
      const start = stylesheet.indexOf(marker);
      expect(start).toBeGreaterThan(-1);
      const bodyStart = stylesheet.indexOf("{", start);
      const bodyEnd = stylesheet.indexOf("\n    }", bodyStart);
      const body = stylesheet.slice(bodyStart, bodyEnd);
      for (const [name, value] of Object.entries(clerkVariables[appearance])) {
        expect(body).toContain(`${name}: ${value};`);
      }
    }
  });
});
