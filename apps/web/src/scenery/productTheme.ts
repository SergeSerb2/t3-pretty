import { T3_CHAT_THEME_ID } from "../themePalette";

import { WORLD_SCENERY_THEME_ID } from "./worldSceneryTheme";

/** Upstream T3 Chat palette. Settings → Appearance calls this Boring. */
export const BORING_CHAT_THEME_ID = T3_CHAT_THEME_ID;

export function isBoringChatTheme(theme: string): boolean {
  return theme === BORING_CHAT_THEME_ID;
}

/** Palettes this fork keeps selectable. Anything else is snapped to World Scenery. */
export function isPrettyProductTheme(theme: string): boolean {
  return theme === WORLD_SCENERY_THEME_ID || theme === BORING_CHAT_THEME_ID;
}

export function shouldForceWorldSceneryTheme(theme: string): boolean {
  return !isPrettyProductTheme(theme);
}
