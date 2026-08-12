import type { ColorValue, ViewStyle } from "react-native";
import { StyleSheet } from "react-native";

import { HOME_HORIZONTAL_INSET } from "../../lib/layoutMetrics";
import type { ThreadListV2GlassClusterRole } from "./threadListV2";

/** Card / chrome radius — 16 stays inside the product card ceiling. */
export const CHROME_GLASS_RADIUS = 16;

/**
 * Standalone frosted card for active/queued rows. Static fill only — native
 * liquid glass samples the backdrop per view and hitches in recycled lists.
 */
export function threadListV2CardPlateStyle(input: {
  readonly fill: ColorValue;
  readonly borderColor: ColorValue;
}): ViewStyle {
  return {
    backgroundColor: input.fill,
    borderColor: input.borderColor,
    borderCurve: "continuous",
    borderRadius: CHROME_GLASS_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    marginHorizontal: HOME_HORIZONTAL_INSET,
    overflow: "hidden",
  };
}

/**
 * One inset frosted plate split across FlatList rows. Adjacent roles share
 * left/right edges and only the first/last rows carry the continuous corner.
 */
export function threadListV2ClusterPlateStyle(input: {
  readonly role: ThreadListV2GlassClusterRole;
  readonly fill: ColorValue;
  readonly borderColor: ColorValue;
}): ViewStyle {
  const radius = CHROME_GLASS_RADIUS;
  const hairline = StyleSheet.hairlineWidth;
  const radii: ViewStyle =
    input.role === "single"
      ? { borderRadius: radius }
      : input.role === "first"
        ? { borderTopLeftRadius: radius, borderTopRightRadius: radius }
        : input.role === "last"
          ? { borderBottomLeftRadius: radius, borderBottomRightRadius: radius }
          : {};
  const borders: ViewStyle =
    input.role === "single"
      ? { borderWidth: hairline }
      : input.role === "first"
        ? {
            borderLeftWidth: hairline,
            borderRightWidth: hairline,
            borderTopWidth: hairline,
          }
        : input.role === "last"
          ? {
              borderBottomWidth: hairline,
              borderLeftWidth: hairline,
              borderRightWidth: hairline,
            }
          : { borderLeftWidth: hairline, borderRightWidth: hairline };
  return {
    backgroundColor: input.fill,
    borderColor: input.borderColor,
    borderCurve: "continuous",
    marginHorizontal: HOME_HORIZONTAL_INSET,
    marginTop: input.role === "first" || input.role === "single" ? 16 : 0,
    overflow: "hidden",
    ...radii,
    ...borders,
  };
}
