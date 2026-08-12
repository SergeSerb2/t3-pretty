/**
 * Unsplash attribution pill for the World Scenery photo behind a screen —
 * "Location · Photo by X", tapping through to the photographer's profile with
 * the required utm parameters. Docked to the screen's bottom-right corner
 * (desktop uses the same corner via --scenery-dock-block) so it sits below
 * chat bubbles and list rows instead of covering them.
 */
import { isLiquidGlassSupported, LiquidGlassView } from "@callstack/liquid-glass";
import * as Linking from "expo-linking";
import { useRef } from "react";
import { Pressable, StyleSheet, useColorScheme, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { UNSPLASH_UTM, type SceneryPhoto } from "./sceneryLogic";

/** Unscaled first-frame estimate (4pt padding + 14pt type). Callers use this
 *  until onHeightChange reports the painted size, which grows with Dynamic
 *  Type. */
export const SCENERY_CREDIT_HEIGHT = 22;
/** Gap between the credit pill and overlaying chrome. */
export const SCENERY_CREDIT_GAP = 6;
/** Floor for the pill's bottom offset when the safe-area inset is 0. */
export const SCENERY_CREDIT_MIN_BOTTOM = 8;

export function SceneryAttribution(props: {
  readonly photo: SceneryPhoto;
  /** Extra offset above the bottom safe area for overlaying chrome such as
   *  the pre-Liquid-Glass 44pt home toolbar or the Android new-task FAB.
   *  Do not pass composer or floating-search heights — those park the pill
   *  on content. */
  readonly bottomExtra?: number;
  /** Painted pill height after layout, including Dynamic Type. */
  readonly onHeightChange?: (height: number) => void;
}) {
  const { photo } = props;
  const insets = useSafeAreaInsets();
  const isDarkMode = useColorScheme() !== "light";
  const reportedHeightRef = useRef(0);
  const bottom = Math.max(insets.bottom, SCENERY_CREDIT_MIN_BOTTOM) + (props.bottomExtra ?? 0);
  const profileURL =
    photo.photographerProfileURL !== null
      ? `${photo.photographerProfileURL}${UNSPLASH_UTM}`
      : `https://unsplash.com/${UNSPLASH_UTM}`;
  const pillStyle = {
    borderCurve: "continuous" as const,
    borderRadius: 999,
    maxWidth: 280,
    overflow: "hidden" as const,
  };
  const label = (
    <Text
      numberOfLines={1}
      style={{
        color: isDarkMode ? "rgba(255, 255, 255, 0.92)" : "rgba(0, 0, 0, 0.88)",
        fontSize: 10,
        lineHeight: 14,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      {photo.name} · Photo by {photo.photographerName}
    </Text>
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const height = Math.ceil(event.nativeEvent.layout.height);
    if (height <= 0 || height === reportedHeightRef.current) {
      return;
    }
    reportedHeightRef.current = height;
    props.onHeightChange?.(height);
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Wallpaper: ${photo.name}. Photo by ${photo.photographerName} on Unsplash.`}
        onLayout={handleLayout}
        onPress={() => void Linking.openURL(profileURL).catch(() => undefined)}
        style={({ pressed }) => ({
          bottom,
          opacity: pressed ? 0.7 : 1,
          position: "absolute",
          right: Math.max(insets.right, 12),
        })}
      >
        {isLiquidGlassSupported ? (
          <LiquidGlassView
            colorScheme={isDarkMode ? "dark" : "light"}
            effect="regular"
            interactive
            style={pillStyle}
          >
            {label}
          </LiquidGlassView>
        ) : (
          <View
            style={[
              pillStyle,
              {
                backgroundColor: isDarkMode ? "rgba(0, 0, 0, 0.58)" : "rgba(255, 255, 255, 0.62)",
                borderColor: isDarkMode ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
                borderWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            {label}
          </View>
        )}
      </Pressable>
    </View>
  );
}
