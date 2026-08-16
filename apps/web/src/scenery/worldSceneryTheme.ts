/**
 * The "World Scenery" theme palette: alpine-nature tones (SurgeCode v0.2.7's
 * AlpineTheme family) with foregrounds tuned for the photo-wallpaper stack.
 * Every text/icon token is pinned by sceneryContrast.test.ts against the
 * worst backdrop the wash can produce over a photo — do not soften one
 * without rerunning that test.
 *
 * Installed as a *custom* theme (localStorage) rather than a built-in so the
 * fork's diff against upstream stays confined to the scenery module: custom
 * themes need no registration in themePalette.ts, index.html boot palettes,
 * or the Settings maintainer list, and they survive app updates.
 */
import {
  getCustomThemes,
  installCustomTheme,
  updateCustomTheme,
  type ThemeColors,
  type ThemeDefinition,
} from "../themePalette";

export const WORLD_SCENERY_THEME_ID = "world-scenery";

/** Bump when the palette below changes so existing installs pick it up. */
export const WORLD_SCENERY_THEME_VERSION = 2;

const THEME_VERSION_STORAGE_KEY = "t3code:scenery:theme-version";

/**
 * Night-forest plate. Keep the canvas hex so splash, terminal, and ink
 * decisions stay put; lift everything that sits *on* it. `accentSurface` is
 * the selected composer chip (PR / Plan use `bg-accent`) — it has to read
 * as moonlit moss, not another dark hole in the glass.
 */
const WORLD_SCENERY_DARK_COLORS: ThemeColors = {
  canvas: "#0e1110",
  chrome: "#0e1110",
  toolbar: "#0e1110",
  toolbarForeground: "#eef2ef",
  toolbarBorder: "#2e3b34",
  toolbarControl: "#1e2822",
  toolbarControlForeground: "#eef2ef",
  toolbarControlHover: "#3c5d4b",
  surface: "#141a17",
  surfaceRaised: "#1a221e",
  surfaceOverlay: "#202a25",
  text: "#f3f6f3",
  textMuted: "#e0e6e1",
  border: "#2e3b34",
  input: "#2c3a32",
  focus: "#98d2ac",
  accent: "#98d2ac",
  accentForeground: "#07140c",
  secondary: "#1a221e",
  secondaryForeground: "#e8eee9",
  muted: "#1a221e",
  mutedForeground: "#c5cfc8",
  placeholder: "#c0cac3",
  secondaryLabel: "#c5cfc8",
  iconMuted: "#c5cfc8",
  error: "#ff7a84",
  errorForeground: "#ffd6da",
  errorSurface: "#3a181c",
  warning: "#ffb020",
  warningForeground: "#ffe08a",
  warningSurface: "#3a2a0c",
  update: "#7ec3ee",
  updateForeground: "#d2ebf8",
  updateSurface: "#143040",
  accentSurface: "#3c5d4b",
  accentSurfaceForeground: "#eaf7ee",
  messageSurface: "#2a4a36",
  messageForeground: "#f3f6f3",
  messageAction: "#98d2ac",
  messageActionForeground: "#07140c",
  messageActionHover: "#84c49b",
  codeBackground: "#101513",
  codeForeground: "#e8ece8",
  sidebar: "#0c100e",
  sidebarForeground: "#f3f6f3",
  sidebarMutedForeground: "#c5cfc8",
  sidebarControlSurface: "#1e2822",
  sidebarRowHover: "#1a221e",
  sidebarRowActive: "#2d4438",
  sidebarRowSelected: "#263a30",
  sidebarBorder: "#26322c",
  terminalBackground: "#0c100e",
  terminalForeground: "#eef2ef",
  terminalCursor: "#b7e6c8",
  terminalSelection: "#2f4338",
  terminalScrollbar: "#2a3831",
  terminalScrollbarHover: "#3a4d43",
};

const WORLD_SCENERY_LIGHT_COLORS: ThemeColors = {
  canvas: "#f4f6f4",
  chrome: "#f4f6f4",
  toolbar: "#f4f6f4",
  toolbarForeground: "#232823",
  toolbarBorder: "#d8ded9",
  toolbarControl: "#ffffff",
  toolbarControlForeground: "#232823",
  toolbarControlHover: "#e9eeea",
  surface: "#ffffff",
  surfaceRaised: "#fafcfa",
  surfaceOverlay: "#ffffff",
  text: "#161a17",
  textMuted: "#2c332e",
  border: "#d8ded9",
  input: "#c9d1ca",
  focus: "#27633f",
  accent: "#27633f",
  accentForeground: "#ffffff",
  secondary: "#eaf0eb",
  secondaryForeground: "#232823",
  muted: "#eaf0eb",
  mutedForeground: "#4b524c",
  placeholder: "#414843",
  secondaryLabel: "#4b524c",
  iconMuted: "#3f473f",
  error: "#c22030",
  errorForeground: "#850e27",
  errorSurface: "#fbe9eb",
  warning: "#b45309",
  warningForeground: "#6f3602",
  warningSurface: "#f8efdd",
  update: "#1d5f8a",
  updateForeground: "#0f3050",
  updateSurface: "#e1edf5",
  accentSurface: "#e3efe6",
  accentSurfaceForeground: "#1c4630",
  messageSurface: "#dfefe3",
  messageForeground: "#14301f",
  messageAction: "#27633f",
  messageActionForeground: "#ffffff",
  messageActionHover: "#225738",
  codeBackground: "#ffffff",
  codeForeground: "#242925",
  sidebar: "#eef3ef",
  sidebarForeground: "#1d221e",
  sidebarMutedForeground: "#4b524c",
  sidebarControlSurface: "#e3e9e4",
  sidebarRowHover: "#e8eee9",
  sidebarRowActive: "#dde5de",
  sidebarRowSelected: "#e3e9e4",
  sidebarBorder: "#d8ded9",
  terminalBackground: "#f4f6f4",
  terminalForeground: "#232823",
  terminalCursor: "#2c6e47",
  terminalSelection: "#cfe0d3",
  terminalScrollbar: "#d3dad4",
  terminalScrollbarHover: "#bdc7bf",
};

export const WORLD_SCENERY_THEME: ThemeDefinition = {
  id: WORLD_SCENERY_THEME_ID,
  label: "World Scenery",
  appearance: "dark",
  colors: WORLD_SCENERY_DARK_COLORS,
  variants: { light: WORLD_SCENERY_LIGHT_COLORS },
};

/**
 * Install the theme into the user's theme library (or refresh it after a
 * palette bump). Runs on every boot. Once the current version has been
 * written, absence means the user deleted the theme in Settings — that
 * choice is respected until the next palette version bump.
 */
export function ensureWorldSceneryThemeInstalled(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const storedVersion = window.localStorage.getItem(THEME_VERSION_STORAGE_KEY);
    if (storedVersion === String(WORLD_SCENERY_THEME_VERSION)) {
      return;
    }
    const installed = getCustomThemes().some((theme) => theme.id === WORLD_SCENERY_THEME_ID);
    if (installed) {
      updateCustomTheme(WORLD_SCENERY_THEME);
    } else {
      installCustomTheme(WORLD_SCENERY_THEME);
    }
    window.localStorage.setItem(THEME_VERSION_STORAGE_KEY, String(WORLD_SCENERY_THEME_VERSION));
  } catch (error) {
    // A full theme library or storage failure must never block the app.
    console.warn("World Scenery theme install skipped:", error);
  }
}
