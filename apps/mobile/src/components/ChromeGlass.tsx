import { isLiquidGlassSupported, LiquidGlassView } from "@callstack/liquid-glass";
import type { ReactNode } from "react";
import { StyleSheet, useColorScheme, View, type StyleProp, type ViewStyle } from "react-native";

import { useThemeColor } from "../lib/useThemeColor";

/** Card / chrome radius — 16 stays inside the product card ceiling. */
export const CHROME_GLASS_RADIUS = 16;

/**
 * Frosted chrome for a handful of floating surfaces (active thread cards,
 * attribution, composer-adjacent pills). Do not use on long recycled lists:
 * native glass samples the backdrop per view and will hitch while scrolling.
 */
export function ChromeGlass(props: {
  readonly children: ReactNode;
  readonly interactive?: boolean;
  readonly radius?: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const isDarkMode = useColorScheme() === "dark";
  const fill = useThemeColor("--color-chrome-glass");
  const borderColor = useThemeColor("--color-chrome-glass-border");
  const radius = props.radius ?? CHROME_GLASS_RADIUS;
  const surfaceStyle: ViewStyle = {
    borderCurve: "continuous",
    borderRadius: radius,
    overflow: "hidden",
  };

  if (isLiquidGlassSupported) {
    return (
      <LiquidGlassView
        colorScheme={isDarkMode ? "dark" : "light"}
        effect="regular"
        interactive={props.interactive ?? true}
        style={[surfaceStyle, props.style]}
      >
        {props.children}
      </LiquidGlassView>
    );
  }

  return (
    <View
      style={[
        surfaceStyle,
        {
          backgroundColor: fill,
          borderColor,
          borderWidth: StyleSheet.hairlineWidth,
        },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}
