import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, type ColorValue } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { MOTION_POP_SPRING, MOTION_PRESS_SPRING } from "../lib/motion";
import { SymbolView, type AppSymbolName } from "./AppSymbol";
import { AppText as Text } from "./AppText";

/**
 * Flat pastel mint, independent of the selected theme so the controls read
 * as one family everywhere. Solid fills, no blur or sheen; ink stays dark
 * enough on the tint for 4.5:1.
 */
const MINT = {
  light: {
    fill: "#BFEED3",
    fillSelected: "#9BE2BB",
    rim: "rgba(23, 96, 63, 0.10)",
    ink: "#145238",
    shadow: "0 1px 2px rgba(20, 82, 56, 0.14)",
  },
  dark: {
    fill: "#A6E3C2",
    fillSelected: "#86D8AC",
    rim: "rgba(255, 255, 255, 0.18)",
    ink: "#0E3A26",
    shadow: "0 1px 3px rgba(0, 0, 0, 0.35)",
  },
} as const;

export const MINT_GLASS_SIZE = 40;

/**
 * A round (icon) or capsule (label) flat pastel-mint control. Used for
 * header corners and floating circle controls on iOS. Pressing sinks the
 * plate while the glyph swells, then both spring back with a small overshoot.
 */
export function MintGlassButton(props: {
  readonly icon?: AppSymbolName;
  readonly iconNode?: ReactNode;
  readonly label?: string;
  readonly accessibilityLabel?: string;
  readonly onPress?: () => void;
  readonly onPressIn?: () => void;
  readonly onPressOut?: () => void;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly tintColor?: ColorValue;
  readonly size?: number;
  /** False when a wrapping menu is the accessible element. */
  readonly accessible?: boolean;
}) {
  const { themeAppearance } = useAppearancePreferences();
  const palette = MINT[themeAppearance === "dark" ? "dark" : "light"];
  const scale = useSharedValue(1);
  const plateStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // The glyph moves against the plate, so a press reads as a squeeze.
  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (1 - scale.value) * 0.6 }],
  }));

  const size = props.size ?? MINT_GLASS_SIZE;
  const isCapsule = !props.icon && !props.iconNode && Boolean(props.label);
  const radius = size / 2;
  const ink = props.tintColor ?? palette.ink;

  return (
    <Animated.View
      style={[
        {
          borderRadius: radius,
          boxShadow: props.disabled ? undefined : palette.shadow,
          opacity: props.disabled ? 0.45 : 1,
        },
        plateStyle,
      ]}
    >
      <Pressable
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        accessibilityRole="button"
        accessibilityState={{ disabled: props.disabled, selected: props.selected }}
        disabled={props.disabled}
        accessible={props.accessible}
        hitSlop={6}
        onPress={props.onPress}
        onPressIn={() => {
          scale.set(withSpring(0.88, MOTION_PRESS_SPRING));
          if (Platform.OS === "ios") void Haptics.selectionAsync().catch(() => undefined);
          props.onPressIn?.();
        }}
        onPressOut={() => {
          scale.set(withSpring(1, MOTION_POP_SPRING));
          props.onPressOut?.();
        }}
        style={{
          height: size,
          width: isCapsule ? undefined : size,
          minWidth: size,
          paddingHorizontal: isCapsule ? 14 : 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius,
          borderCurve: "continuous",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.rim,
          backgroundColor: props.selected ? palette.fillSelected : palette.fill,
        }}
      >
        <Animated.View pointerEvents="none" style={glyphStyle}>
          {props.iconNode ??
            (props.icon ? (
              <SymbolView
                name={props.icon}
                size={Math.round(size * 0.46)}
                tintColor={ink}
                type="monochrome"
                weight="semibold"
              />
            ) : (
              <Text
                numberOfLines={1}
                style={{ color: ink, fontSize: 15, fontWeight: "600", letterSpacing: -0.2 }}
              >
                {props.label}
              </Text>
            ))}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
