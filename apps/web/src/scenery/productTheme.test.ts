import { describe, expect, it } from "vite-plus/test";

import { T3_CHAT_THEME_ID } from "../themePalette";
import {
  BORING_CHAT_THEME_ID,
  isBoringChatTheme,
  isPrettyProductTheme,
  shouldForceWorldSceneryTheme,
} from "./productTheme";
import { WORLD_SCENERY_THEME_ID } from "./worldSceneryTheme";

describe("pretty product themes", () => {
  it("names Boring as the upstream T3 Chat palette", () => {
    expect(BORING_CHAT_THEME_ID).toBe(T3_CHAT_THEME_ID);
    expect(isBoringChatTheme(T3_CHAT_THEME_ID)).toBe(true);
    expect(isBoringChatTheme(WORLD_SCENERY_THEME_ID)).toBe(false);
  });

  it("keeps World Scenery and Boring, and snaps every other preference", () => {
    expect(isPrettyProductTheme(WORLD_SCENERY_THEME_ID)).toBe(true);
    expect(isPrettyProductTheme(BORING_CHAT_THEME_ID)).toBe(true);
    expect(shouldForceWorldSceneryTheme(WORLD_SCENERY_THEME_ID)).toBe(false);
    expect(shouldForceWorldSceneryTheme(BORING_CHAT_THEME_ID)).toBe(false);
    expect(shouldForceWorldSceneryTheme("system")).toBe(true);
    expect(shouldForceWorldSceneryTheme("grove")).toBe(true);
    expect(shouldForceWorldSceneryTheme("light")).toBe(true);
  });
});
