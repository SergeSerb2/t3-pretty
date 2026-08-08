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
export const WORLD_SCENERY_THEME_VERSION = 1;

const THEME_VERSION_STORAGE_KEY = "t3code:scenery:theme-version";

const WORLD_SCENERY_DARK_COLORS: ThemeColors = {
  canvas: "#0e1110",
  chrome: "#0e1110",
  toolbar: "#0e1110",
  toolbarForeground: "#e8ece9",
  toolbarBorder: "#232b26",
  toolbarControl: "#1a201c",
  toolbarControlForeground: "#e8ece9",
  toolbarControlHover: "#232b26",
  surface: "#131715",
  surfaceRaised: "#161b18",
  surfaceOverlay: "#1b211d",
  text: "#f0f2ef",
  textMuted: "#dee3de",
  border: "#232b26",
  input: "#2a332d",
  focus: "#91c9a3",
  accent: "#91c9a3",
  accentForeground: "#0c1710",
  secondary: "#161b18",
  secondaryForeground: "#e6eae6",
  muted: "#161b18",
  mutedForeground: "#b6bcb7",
  placeholder: "#b3bcb5",
  secondaryLabel: "#b6bcb7",
  iconMuted: "#b0b9b2",
  error: "#fb6a76",
  errorForeground: "#ffd2d7",
  errorSurface: "#33161a",
  warning: "#fe9a00",
  warningForeground: "#ffdb85",
  warningSurface: "#33270e",
  update: "#6cb8e8",
  updateForeground: "#c8e6f5",
  updateSurface: "#12242f",
  accentSurface: "#1c2620",
  accentSurfaceForeground: "#d7e7dc",
  messageSurface: "#24422f",
  messageForeground: "#f2f4f1",
  messageAction: "#91c9a3",
  messageActionForeground: "#0c1710",
  messageActionHover: "#7fbc93",
  codeBackground: "#101412",
  codeForeground: "#e4e7e4",
  sidebar: "#0c0f0d",
  sidebarForeground: "#eef1ee",
  sidebarMutedForeground: "#b6bcb7",
  sidebarControlSurface: "#1a201c",
  sidebarRowHover: "#161b18",
  sidebarRowActive: "#1f2621",
  sidebarRowSelected: "#1b211d",
  sidebarBorder: "#1d2420",
  terminalBackground: "#0c0f0d",
  terminalForeground: "#e8ebe8",
  terminalCursor: "#b5e3c5",
  terminalSelection: "#2c3a31",
  terminalScrollbar: "#26302a",
  terminalScrollbarHover: "#33403a",
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
 * palette bump). Runs on every boot; a no-op once the current version is in.
 */
export function ensureWorldSceneryThemeInstalled(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const installed = getCustomThemes().some((theme) => theme.id === WORLD_SCENERY_THEME_ID);
    const storedVersion = Number(window.localStorage.getItem(THEME_VERSION_STORAGE_KEY));
    if (installed && storedVersion === WORLD_SCENERY_THEME_VERSION) {
      return;
    }
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
