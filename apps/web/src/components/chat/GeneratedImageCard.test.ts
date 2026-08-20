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

  it("keeps literal %2F segments in Grok session image paths", () => {
    const grokPath =
      "/Users/serge/.grok/sessions/%2FUsers%2Fserge%2FDocuments%2FGeneral/01a01d95/images/1.jpg";
    expect(resolveGeneratedImageAssetPath(grokPath, "/Users/serge/Documents/General")).toBe(
      grokPath,
    );
  });

  it("rewrites markdown images/1.jpg to the generating Grok session file", () => {
    const grokPath =
      "/Users/serge/.grok/sessions/%2FUsers%2Fserge%2FDocuments%2FGeneral/01a01d95/images/1.jpg";
    expect(
      resolveGeneratedImageAssetPath("images/1.jpg", "/Users/serge/Documents/General", [grokPath]),
    ).toBe(grokPath);
  });
});
