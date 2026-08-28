import { describe, expect, it } from "vite-plus/test";

import { settingsEscapeAction } from "./settingsEscape";

function element(tagName: string, insideOwnedSurface = false): Element {
  return {
    tagName,
    isContentEditable: false,
    closest: () => (insideOwnedSurface ? ({} as Element) : null),
  } as unknown as Element;
}

describe("settingsEscapeAction", () => {
  it("blurs an edited field before leaving settings", () => {
    expect(settingsEscapeAction(element("INPUT"))).toBe("blur");
    expect(settingsEscapeAction(element("TEXTAREA"))).toBe("blur");
  });

  it("leaves Escape to dialogs and popups that own it", () => {
    expect(settingsEscapeAction(element("INPUT", true))).toBe("ignore");
  });

  it("navigates when focus is not editing or inside an owned surface", () => {
    expect(settingsEscapeAction(element("BUTTON"))).toBe("navigate");
    expect(settingsEscapeAction(null)).toBe("navigate");
  });
});
