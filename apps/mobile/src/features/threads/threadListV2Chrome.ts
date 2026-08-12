import type { ColorValue, ViewStyle } from "react-native";
import { StyleSheet } from "react-native";

import { HOME_HORIZONTAL_INSET } from "../../lib/layoutMetrics";

/** Card / chrome radius — 16 stays inside the product card ceiling. */
export const CHROME_GLASS_RADIUS = 16;

/**
 * Standalone frosted card for active/queued rows and receded snoozed/settled
 * history. Static fill only — native liquid glass samples the backdrop per
 * view and hitches in recycled lists. Compact density keeps parked work in
 * the same card language without matching the inbox's vertical rhythm.
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
    borderRadius: CHROME_GLASS_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: input.compact === true ? 8 : 10,
    marginHorizontal: HOME_HORIZONTAL_INSET,
    overflow: "hidden",
  };
}
