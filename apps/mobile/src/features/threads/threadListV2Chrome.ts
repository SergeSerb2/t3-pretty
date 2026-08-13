import type { ColorValue, ViewStyle } from "react-native";
import { StyleSheet } from "react-native";

import { HOME_HORIZONTAL_INSET } from "../../lib/layoutMetrics";

/** Active-work card radius — 16 stays inside the product card ceiling. */
export const CHROME_GLASS_RADIUS = 16;

/**
 * Standalone frosted card for active and queued work. Static fill only —
 * native liquid glass samples the backdrop per view and hitches in recycled
 * lists. Compact cards are deliberately tighter so queued work sits between
 * the live block and the flat history shelves in the visual hierarchy.
 */
export function threadListV2CardPlateStyle(input: {
  readonly fill: ColorValue;
  readonly borderColor: ColorValue;
  readonly compact?: boolean;
}): ViewStyle {
  return {
    backgroundColor: input.fill,
    borderColor: input.borderColor,
    borderCurve: "continuous",
    borderRadius: input.compact === true ? 12 : CHROME_GLASS_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: input.compact === true ? 8 : 10,
    marginHorizontal: HOME_HORIZONTAL_INSET,
    overflow: "hidden",
  };
}

/**
 * Parked and settled work recedes into a flat, inset ledger over scenery.
 * The screen wash already carries contrast, so a hairline is enough to keep
 * rows scannable without giving every historical item its own glass card.
 */
export function threadListV2QuietRowStyle(input: {
  readonly borderColor: ColorValue;
  readonly showTrailingDivider: boolean;
}): ViewStyle {
  return {
    borderBottomColor: input.borderColor,
    borderBottomWidth: input.showTrailingDivider ? StyleSheet.hairlineWidth : 0,
    marginHorizontal: HOME_HORIZONTAL_INSET,
  };
}
