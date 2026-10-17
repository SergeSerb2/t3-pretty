import defaultThemeVariables from "../../generated-uniwind-default-theme-variables.json";
import {
  DEFAULT_MOBILE_THEME_ID,
  flattenThemeColor,
  getMobileThemeVariables,
  themeColorWithAlpha,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeVariables,
} from "./mobileTheme";

const defaults = defaultThemeVariables as Readonly<
  Record<MobileThemeAppearance, MobileThemeVariables>
>;

/**
 * Complete palette for native and third-party APIs that cannot consume a
 * Uniwind className. Every palette shares the source that generates its
 * registered CSS theme.
 */
export function getMobileThemeRuntimeVariables(
  themeId: MobileThemeId,
  appearance: MobileThemeAppearance,
  platform: string,
): MobileThemeVariables {
  const usesDefaultPalette = themeId === DEFAULT_MOBILE_THEME_ID || themeId === "material-you";
  const variables = usesDefaultPalette
    ? defaults[appearance]
    : getMobileThemeVariables(themeId, appearance);
  // Android's frame surrounds the sidebar and chat panes. Light iPad sidebars
  // reuse that stronger tonal fill; dark sidebars retain the shared black pane
  // beneath the near-black chat canvas. System colors replace these roles later.
  // The default hover is a translucent accent. Resolve it over the screen so
  // an opaque frame keeps that tint instead of becoming the solid accent.
  const frame = usesDefaultPalette
    ? flattenThemeColor(variables["--color-row-hover"], variables["--color-screen"])
    : themeColorWithAlpha(variables["--color-drawer"], 1);
  if (platform === "ios" && usesDefaultPalette && appearance === "light") {
    return {
      ...variables,
      "--color-header": frame,
      "--color-header-foreground": variables["--color-drawer-foreground"],
      "--color-drawer": frame,
      "--color-drawer-foreground-muted": variables["--color-foreground-muted"],
    };
  }
  if (platform !== "android") return variables;

  return {
    ...variables,
    "--color-header": frame,
    "--color-header-foreground": variables["--color-drawer-foreground"],
    "--color-drawer": variables["--color-screen"],
  };
}
