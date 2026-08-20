import { describe, expect, it } from "vite-plus/test";

import {
  fadingImageClassName,
  generatedImagePathsByTurnFromWorkEntries,
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

  it("groups Imagine files by the turn that produced them", () => {
    const first = "/Users/serge/.grok/sessions/%2Fold/session-a/images/1.jpg";
    const second = "/Users/serge/.grok/sessions/%2Fnew/session-b/images/1.jpg";
    const byTurn = generatedImagePathsByTurnFromWorkEntries([
      {
        id: "image-1",
        createdAt: "2026-08-20T00:00:00.000Z",
        turnId: "turn-1" as never,
        label: "Generated image",
        tone: "tool",
        itemType: "image_generation",
        changedFiles: [first],
      },
      {
        id: "image-2",
        createdAt: "2026-08-20T00:01:00.000Z",
        turnId: "turn-2" as never,
        label: "Generated image",
        tone: "tool",
        itemType: "image_generation",
        changedFiles: [second],
      },
    ]);
    expect(byTurn.get("turn-1")).toEqual([first]);
    expect(byTurn.get("turn-2")).toEqual([second]);
    expect(
      resolveGeneratedImageAssetPath("images/1.jpg", "/repo", byTurn.get("turn-1") ?? []),
    ).toBe(first);
  });
});
