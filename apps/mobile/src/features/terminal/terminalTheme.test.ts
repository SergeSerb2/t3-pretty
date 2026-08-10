import { describe, expect, it } from "vite-plus/test";

import { buildGhosttyThemeConfig, getPierreTerminalTheme } from "./terminalTheme";

describe("getPierreTerminalTheme", () => {
  it("returns the Pierre light terminal palette", () => {
    expect(getPierreTerminalTheme("light")).toMatchObject({
      background: "#f4f6f4",
      foreground: "#6C6C71",
      cursorForeground: "#009fff",
      cursorBackground: "#f4f6f4",
    });
  });

  it("returns the Pierre dark terminal palette", () => {
    expect(getPierreTerminalTheme("dark")).toMatchObject({
      background: "#0e1110",
      foreground: "#adadb1",
      cursorForeground: "#009fff",
      cursorBackground: "#0e1110",
    });
  });
});

describe("buildGhosttyThemeConfig", () => {
  it("serializes theme colors into a ghostty config file", () => {
    const config = buildGhosttyThemeConfig(getPierreTerminalTheme("dark"));

    expect(config).toContain("background = #0e1110");
    expect(config).toContain("foreground = #adadb1");
    expect(config).toContain("cursor-color = #009fff");
    expect(config).toContain("palette = 0=#141415");
    expect(config).toContain("palette = 15=#c6c6c8");
    expect(config.endsWith("\n")).toBe(true);
  });
});
