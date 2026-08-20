import { describe, expect, it } from "vite-plus/test";

import {
  classifyImageToolItemType,
  extractGeneratedImagePath,
  projectNeedsGeneratedIcon,
} from "./imageTool.ts";

describe("classifyImageToolItemType", () => {
  it("maps Codex imageGeneration items to image_generation", () => {
    expect(classifyImageToolItemType({ type: "image generation" })).toBe("image_generation");
    expect(classifyImageToolItemType({ type: "imageGeneration" })).toBe("image_generation");
    expect(classifyImageToolItemType({ type: "image_generation_call" })).toBe("image_generation");
  });

  it("maps Grok imagine / imagegen tools to image_generation", () => {
    expect(classifyImageToolItemType({ title: "Imagine" })).toBe("image_generation");
    expect(classifyImageToolItemType({ toolName: "image_gen" })).toBe("image_generation");
    expect(classifyImageToolItemType({ toolName: "imagegen" })).toBe("image_generation");
  });

  it("keeps ordinary image views as image_view", () => {
    expect(classifyImageToolItemType({ type: "image view" })).toBe("image_view");
    expect(classifyImageToolItemType({ toolName: "Read image" })).toBe("image_view");
  });

  it("returns undefined when the tool is unrelated", () => {
    expect(classifyImageToolItemType({ toolName: "bash" })).toBeUndefined();
  });
});

describe("extractGeneratedImagePath", () => {
  it("prefers Codex savedPath when it is an image", () => {
    expect(
      extractGeneratedImagePath({
        data: { item: { savedPath: "/tmp/cat.png", status: "completed" } },
      }),
    ).toBe("/tmp/cat.png");
  });

  it("reads ACP locations and skips remote URIs", () => {
    expect(
      extractGeneratedImagePath({
        data: {
          locations: [{ path: "/repo/out.webp" }],
          content: [
            {
              type: "content",
              content: { type: "image", uri: "https://cdn.example/x.png" },
            },
          ],
        },
      }),
    ).toBe("/repo/out.webp");
  });

  it("falls back to changed files and detail", () => {
    expect(
      extractGeneratedImagePath({
        changedFiles: ["notes.md", "assets/icon.jpg"],
      }),
    ).toBe("assets/icon.jpg");
    expect(extractGeneratedImagePath({ detail: "generated/hero.gif" })).toBe("generated/hero.gif");
  });
});

describe("projectNeedsGeneratedIcon", () => {
  it("is true only when no icon path is stored", () => {
    expect(projectNeedsGeneratedIcon(null)).toBe(true);
    expect(projectNeedsGeneratedIcon(undefined)).toBe(true);
    expect(projectNeedsGeneratedIcon("")).toBe(true);
    expect(projectNeedsGeneratedIcon("t3-project-icon/abc-icon.png")).toBe(false);
    expect(projectNeedsGeneratedIcon("assets/logo.svg")).toBe(false);
  });
});
