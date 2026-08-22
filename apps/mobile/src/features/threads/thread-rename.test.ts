import { describe, expect, it } from "vite-plus/test";

import { normalizeThreadTitleInput, THREAD_RENAME_MENU_ACTION } from "./thread-rename";

describe("THREAD_RENAME_MENU_ACTION", () => {
  it("uses the rename event id the row menus dispatch on", () => {
    expect(THREAD_RENAME_MENU_ACTION).toEqual({
      id: "rename",
      title: "Rename thread",
      image: "pencil",
    });
  });
});

describe("normalizeThreadTitleInput", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeThreadTitleInput("  Fix the thing  ")).toBe("Fix the thing");
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(normalizeThreadTitleInput("")).toBeNull();
    expect(normalizeThreadTitleInput("   ")).toBeNull();
  });
});
