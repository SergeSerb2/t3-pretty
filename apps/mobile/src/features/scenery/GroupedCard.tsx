import { Platform, StyleSheet, View, type ViewProps } from "react-native";

import { cn } from "../../lib/cn";
import { GLASS_CARD_RADIUS } from "../../lib/layoutMetrics";
import { useGlassChromeActive } from "./SceneryProvider";

/**
 * Container for a group of rows. Over scenery on iOS it is a frosted glass
 * card (translucent fill + hairline edge, no live blur); elsewhere it is the
 * opaque grouped card. Rows inside paint no fill of their own.
 */
export function GroupedCard({ className, style, ...props }: ViewProps) {
  const glass = useGlassChromeActive();
  return (
    <View
      {...props}
      className={cn(
        Platform.OS === "android"
          ? "overflow-hidden rounded-[28px] bg-grouped-card"
          : glass
            ? "overflow-hidden border-chrome-glass-border bg-chrome-glass"
            : "overflow-hidden rounded-[24px] border-continuous bg-grouped-card",
        className,
      )}
      style={[
        glass
          ? {
              // Inline because cn() drops `border-continuous` beside a border color.
              borderCurve: "continuous",
              borderRadius: GLASS_CARD_RADIUS,
              borderWidth: StyleSheet.hairlineWidth,
            }
          : undefined,
        style,
      ]}
    />
  );
}
