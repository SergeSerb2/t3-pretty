import { StyleSheet, type ViewStyle } from "react-native";

import { GLASS_CARD_RADIUS } from "../../lib/layoutMetrics";

/** Fill and edge of a glass card; pair with `glassCardStyle`. */
export const GLASS_CARD_CLASS_NAME = "border-chrome-glass-border bg-chrome-glass";

/** Text field on glass: a tint of the card instead of an opaque input plate. */
export const GLASS_INPUT_CLASS_NAME =
  "rounded-[14px] border-[0.5px] border-chrome-glass-border bg-foreground/5";

/**
 * Shape of a glass card, or of one row when list cells assemble the card and
 * cannot share a GroupedCard parent: only the outer corners round and the
 * hairline edge continues across rows.
 */
export function glassCardStyle(isFirst = true, isLast = true): ViewStyle {
  const top = isFirst ? GLASS_CARD_RADIUS : 0;
  const bottom = isLast ? GLASS_CARD_RADIUS : 0;
  return {
    borderCurve: "continuous",
    borderTopLeftRadius: top,
    borderTopRightRadius: top,
    borderBottomLeftRadius: bottom,
    borderBottomRightRadius: bottom,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: isFirst ? StyleSheet.hairlineWidth : 0,
    borderBottomWidth: isLast ? StyleSheet.hairlineWidth : 0,
    overflow: "hidden",
  };
}
