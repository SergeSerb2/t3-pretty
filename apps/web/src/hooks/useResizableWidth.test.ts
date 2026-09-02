import { describe, expect, it } from "vite-plus/test";

import { resizableWidthFromKeyboard } from "./useResizableWidth";

describe("resizableWidthFromKeyboard", () => {
  it("moves a left-edge handle in the visual arrow direction", () => {
    expect(
      resizableWidthFromKeyboard({
        key: "ArrowLeft",
        currentWidth: 500,
        minWidth: 360,
        maxWidth: 800,
        edge: "left",
        step: 16,
      }),
    ).toBe(516);
    expect(
      resizableWidthFromKeyboard({
        key: "ArrowRight",
        currentWidth: 500,
        minWidth: 360,
        maxWidth: 800,
        edge: "left",
        step: 16,
      }),
    ).toBe(484);
  });

  it("clamps Home, End, and arrow changes to the configured range", () => {
    const input = {
      currentWidth: 500,
      minWidth: 360,
      maxWidth: 800,
      edge: "right" as const,
      step: 16,
    };

    expect(resizableWidthFromKeyboard({ ...input, key: "Home" })).toBe(360);
    expect(resizableWidthFromKeyboard({ ...input, key: "End" })).toBe(800);
    expect(resizableWidthFromKeyboard({ ...input, key: "ArrowRight", currentWidth: 795 })).toBe(
      800,
    );
    expect(resizableWidthFromKeyboard({ ...input, key: "Escape" })).toBeNull();
  });
});
