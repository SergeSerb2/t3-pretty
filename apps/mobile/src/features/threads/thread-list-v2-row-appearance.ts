import type { ViewStyle } from "react-native";
import type { MobileThemeVariables } from "../../lib/mobileTheme";

export const THREAD_LIST_V2_MONO_FONT = "Menlo";
export const THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME = "px-5 py-2.5";
export const THREAD_LIST_V2_ROW_DIVIDERS = true;

/** Inset frosted card radius; slim settled rows read as capsules. */
const THREAD_LIST_GLASS_RADIUS = 22;

export const selectedThreadRowColors = {
  foregroundClassName: "text-thread-selected-foreground",
  mutedForegroundClassName: "text-thread-selected-foreground-muted",
  iconTintClassName: "accent-thread-selected-foreground",
  mutedIconTintClassName: "accent-thread-selected-foreground-muted",
};

export function getThreadListV2NewBranchMenuTitle(_branch: string) {
  return "New thread on branch";
}

export function getThreadListV2RowAppearance(
  theme: MobileThemeVariables,
  sidebarPane: boolean,
  selected: boolean,
  glass = false,
) {
  if (glass && !sidebarPane) return getGlassRowAppearance(theme);
  const selectedBackgroundColor = theme["--color-thread-selected"];
  const style: ViewStyle | undefined = sidebarPane
    ? {
        backgroundColor: selected ? selectedBackgroundColor : theme["--color-drawer"],
        borderRadius: 12,
      }
    : undefined;
  const swipeContainerStyle: ViewStyle | undefined = sidebarPane
    ? { borderRadius: 12, overflow: "hidden" }
    : undefined;

  return {
    className: sidebarPane ? undefined : "bg-screen",
    interactionClassName: sidebarPane ? "bg-thread-hover" : "bg-row-hover",
    interactionOpacity: selected ? 0 : 1,
    foregroundClassName: sidebarPane ? "text-drawer-foreground" : "text-foreground",
    mutedForegroundClassName: sidebarPane
      ? "text-drawer-foreground-muted"
      : "text-foreground-muted",
    tertiaryForegroundClassName: sidebarPane
      ? "text-drawer-foreground-muted"
      : "text-foreground-tertiary",
    mutedIconTintClassName: sidebarPane
      ? "accent-drawer-foreground-muted"
      : "accent-foreground-muted",
    tertiaryIconTintClassName: sidebarPane
      ? "accent-drawer-foreground-muted"
      : "accent-foreground-tertiary",
    style,
    cardStyle: sidebarPane ? { ...style, paddingHorizontal: 12, paddingVertical: 10 } : undefined,
    swipeContainerStyle,
    swipeBackgroundColor: theme[sidebarPane ? "--color-drawer" : "--color-screen"],
    swipeActionsBackgroundColor: theme[sidebarPane ? "--color-drawer" : "--color-screen"],
    // Provider badges blend into the surface beneath them.
    providerIconSurfaceColor: sidebarPane
      ? selected
        ? selectedBackgroundColor
        : theme["--color-drawer"]
      : theme["--color-screen"],
  };
}

/**
 * Rows become translucent cards over the CDN pre-blurred photo, so the
 * frosted look costs no live blur; the wash under them still carries text
 * contrast. Shadows stay off: per-row shadows force offscreen passes while
 * the list scrolls.
 */
function getGlassRowAppearance(theme: MobileThemeVariables) {
  const backgroundColor = theme["--color-chrome-glass"];
  const card: ViewStyle = {
    backgroundColor,
    borderColor: theme["--color-chrome-glass-border"],
    borderCurve: "continuous",
    borderRadius: THREAD_LIST_GLASS_RADIUS,
    borderWidth: 0.5,
  };
  return {
    className: undefined,
    interactionClassName: "bg-row-hover",
    interactionOpacity: 1,
    foregroundClassName: "text-foreground",
    mutedForegroundClassName: "text-foreground-muted",
    tertiaryForegroundClassName: "text-foreground-tertiary",
    mutedIconTintClassName: "accent-foreground-muted",
    tertiaryIconTintClassName: "accent-foreground-tertiary",
    style: card,
    cardStyle: card,
    swipeContainerStyle: {
      borderCurve: "continuous",
      borderRadius: THREAD_LIST_GLASS_RADIUS,
      marginHorizontal: 12,
      marginVertical: 4,
      overflow: "hidden",
    } satisfies ViewStyle,
    swipeBackgroundColor: "transparent",
    // The revealed tray continues the card's glass so labels never sit on raw photo.
    swipeActionsBackgroundColor: backgroundColor,
    // No opaque surface to cut the badge out of; the badge sits on the glass.
    providerIconSurfaceColor: "transparent",
  };
}
