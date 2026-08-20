import { describe, expect, it } from "vite-plus/test";

import {
  fadingImageClassName,
  isFadingImageSettled,
  resolveGeneratedImageAssetPath,
} from "./GeneratedImageCard";

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

describe("resolveGeneratedImageAssetPath", () => {
  it("joins a workspace-relative image against the project cwd", () => {
    expect(resolveGeneratedImageAssetPath("assets/icon.png", "/repo/project")).toBe(
      "/repo/project/assets/icon.png",
    );
  });

  it("keeps an absolute image path", () => {
    expect(resolveGeneratedImageAssetPath("/repo/project/assets/icon.png", "/repo/project")).toBe(
      "/repo/project/assets/icon.png",
    );
  });

  it("keeps a relative image path when cwd is missing so the asset API can resolve it", () => {
    expect(resolveGeneratedImageAssetPath("assets/icon.png", undefined)).toBe("assets/icon.png");
  });

  it("rejects non-image paths", () => {
    expect(resolveGeneratedImageAssetPath("README.md", "/repo/project")).toBeNull();
  });
});
