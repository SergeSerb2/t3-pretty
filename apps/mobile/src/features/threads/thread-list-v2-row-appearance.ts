import type { ViewStyle } from "react-native";
import { GLASS_CARD_RADIUS } from "../../lib/layoutMetrics";
import type { MobileThemeVariables } from "../../lib/mobileTheme";

export const THREAD_LIST_V2_MONO_FONT = "Menlo";
export const THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME = "px-5 py-2.5";
export const THREAD_LIST_V2_ROW_DIVIDERS = true;

export const selectedThreadRowColors = {
  foregroundClassName: "text-thread-selected-foreground",
  mutedForegroundClassName: "text-thread-selected-foreground-muted",
  iconTintClassName: "accent-thread-selected-foreground",
  mutedIconTintClassName: "accent-thread-selected-foreground-muted",
};

export function getThreadListV2NewBranchMenuTitle(_branch: string) {
  return "New thread on branch";
}

/** Where a glass row sits in a run of rows that join into one grouped card. */
export interface ThreadListV2RowGroup {
  readonly joinsPrevious: boolean;
  readonly joinsNext: boolean;
}

const SOLO_ROW: ThreadListV2RowGroup = { joinsPrevious: false, joinsNext: false };

export function getThreadListV2RowAppearance(
  theme: MobileThemeVariables,
  sidebarPane: boolean,
  selected: boolean,
  glass = false,
  group: ThreadListV2RowGroup = SOLO_ROW,
) {
  if (glass && !sidebarPane) return getGlassRowAppearance(theme, group);
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
    outlineStyle: undefined,
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
 * the list scrolls. Consecutive shelf rows join into one grouped card: inner
 * edges lose their corners, gap and outline, and the row draws a separator.
 */
function getGlassRowAppearance(theme: MobileThemeVariables, group: ThreadListV2RowGroup) {
  const backgroundColor = theme["--color-chrome-glass"];
  const topRadius = group.joinsPrevious ? 0 : GLASS_CARD_RADIUS;
  const bottomRadius = group.joinsNext ? 0 : GLASS_CARD_RADIUS;
  const corners: ViewStyle = {
    borderBottomLeftRadius: bottomRadius,
    borderBottomRightRadius: bottomRadius,
    borderCurve: "continuous",
    borderTopLeftRadius: topRadius,
    borderTopRightRadius: topRadius,
  };
  // The fill stays square: the rounded swipe container clips it, so a swipe
  // slides content across one continuous slab instead of a card with
  // corners of its own pulling away from the tray.
  const card: ViewStyle = { backgroundColor };
  const marginTop = group.joinsPrevious ? 0 : 4;
  const marginBottom = group.joinsNext ? 0 : 4;
  // An overlay over the swipe container rather than real borders: it stays
  // put while content swipes, and a half-point top or bottom border would
  // make the row's height fractional, so the next list cell would land a
  // device pixel short and show the photo through the seam.
  const outline: ViewStyle = {
    ...corners,
    borderBottomWidth: group.joinsNext ? 0 : 0.5,
    borderColor: theme["--color-chrome-glass-border"],
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderTopWidth: group.joinsPrevious ? 0 : 0.5,
    bottom: marginBottom,
    left: 12,
    position: "absolute",
    right: 12,
    top: marginTop,
  };
  return {
    className: undefined,
    // A translucent tint, never an opaque plate over the glass.
    interactionClassName: "bg-foreground/[0.06]",
    interactionOpacity: 1,
    foregroundClassName: "text-foreground",
    mutedForegroundClassName: "text-foreground-muted",
    tertiaryForegroundClassName: "text-foreground-tertiary",
    mutedIconTintClassName: "accent-foreground-muted",
    tertiaryIconTintClassName: "accent-foreground-tertiary",
    style: card,
    cardStyle: card,
    outlineStyle: outline,
    swipeContainerStyle: {
      ...corners,
      marginBottom,
      marginHorizontal: 12,
      marginTop,
      overflow: "hidden",
    } satisfies ViewStyle,
    swipeBackgroundColor: "transparent",
    // The revealed tray continues the card's glass so labels never sit on raw photo.
    swipeActionsBackgroundColor: backgroundColor,
    // No opaque surface to cut the badge out of; the badge sits on the glass.
    providerIconSurfaceColor: "transparent",
  };
}
