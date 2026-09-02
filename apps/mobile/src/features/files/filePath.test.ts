import { describe, expect, it } from "vite-plus/test";

import {
  isBrowserPreviewFile,
  isImagePreviewFile,
  isSvgImagePreviewFile,
  normalizeMobileFileRoutePath,
  resolveWorkspaceRelativeFilePath,
} from "./filePath";

describe("normalizeMobileFileRoutePath", () => {
  it("normalizes bounded route segments without materializing oversized paths", () => {
    expect(normalizeMobileFileRoutePath(["src", ".", "features", "..", "main.ts"])).toBe(
      "src/main.ts",
    );
    expect(normalizeMobileFileRoutePath(["..", "outside.ts"])).toBeNull();
    expect(normalizeMobileFileRoutePath("x".repeat(513))).toBeNull();
    expect(normalizeMobileFileRoutePath(["x".repeat(256), "y".repeat(256)])).toBeNull();
  });
});

describe("resolveWorkspaceRelativeFilePath", () => {
  it("keeps normalized workspace-relative paths", () => {
    expect(resolveWorkspaceRelativeFilePath("/repo", "./src/../src/main.ts")).toBe("src/main.ts");
  });

  it("converts absolute paths inside the workspace", () => {
    expect(
      resolveWorkspaceRelativeFilePath("/Users/julius/repo", "/Users/julius/repo/src/main.ts"),
    ).toBe("src/main.ts");
    expect(resolveWorkspaceRelativeFilePath("C:\\repo", "c:\\repo\\src\\main.ts")).toBe(
      "src/main.ts",
    );
  });

  it("rejects paths outside the workspace", () => {
    expect(resolveWorkspaceRelativeFilePath("/repo", "/other/main.ts")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath("/repo", "../other/main.ts")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath(null, "/repo/main.ts")).toBeNull();
  });
});

describe("file preview types", () => {
  it("recognizes browser and image previews", () => {
    expect(isBrowserPreviewFile("reports/summary.html")).toBe(true);
    expect(isImagePreviewFile("assets/icon.png")).toBe(true);
    expect(isImagePreviewFile("assets/diagram.SVG?raw=1")).toBe(true);
    expect(isImagePreviewFile("src/image.ts")).toBe(false);
  });

  it("identifies SVG images that need web rendering", () => {
    expect(isSvgImagePreviewFile("assets/diagram.svg#icon")).toBe(true);
    expect(isSvgImagePreviewFile("assets/photo.png")).toBe(false);
  });
});
