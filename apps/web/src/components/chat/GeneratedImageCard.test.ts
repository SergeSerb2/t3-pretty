import { describe, expect, it } from "vite-plus/test";

import { fadingImageClassName, isFadingImageSettled } from "./GeneratedImageCard";

describe("generated image fade-in", () => {
  it("keeps the image hidden until load has settled", () => {
    const pending = fadingImageClassName(false).split(/\s+/);
    const revealed = fadingImageClassName(true).split(/\s+/);
    expect(pending).toContain("opacity-0");
    expect(pending).not.toContain("opacity-100");
    expect(revealed).toContain("opacity-100");
  });

  it("treats cached and already-complete images as settled without onLoad", () => {
    expect(isFadingImageSettled({ complete: true })).toBe(true);
    expect(isFadingImageSettled({ complete: false })).toBe(false);
    expect(isFadingImageSettled(null)).toBe(false);
  });
});
