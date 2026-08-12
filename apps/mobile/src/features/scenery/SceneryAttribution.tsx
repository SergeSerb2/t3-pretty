/**
 * Unsplash attribution pill for the World Scenery photo behind a screen —
 * "Location · Photo by X", tapping through to the photographer's profile with
 * the required utm parameters. Horizontally centered under floating chrome /
 * above the home-indicator strip so long credits stay clear of the device's
 * rounded corners (desktop still docks bottom-right via --scenery-dock-block).
 */
import { isLiquidGlassSupported, LiquidGlassView } from "@callstack/liquid-glass";
import * as Linking from "expo-linking";
import { useRef } from "react";
import {
  Pressable,
  StyleSheet,
  useColorScheme,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { UNSPLASH_UTM, type SceneryPhoto } from "./sceneryLogic";

/** Unscaled first-frame estimate (4pt padding + 14pt type). Callers use this
 *  until onHeightChange reports the painted size, which grows with Dynamic
 *  Type. */
export const SCENERY_CREDIT_HEIGHT = 22;
/** Gap between the credit pill and overlaying chrome. */
export const SCENERY_CREDIT_GAP = 6;
/**
 * Minimum gap above the physical bottom edge when a caller opts into
 * `dockUnderFloatingChrome` (Liquid Glass Home). Elsewhere the credit clears
 * the home-indicator / system-nav inset via safe area.
 */
export const SCENERY_CREDIT_MIN_BOTTOM = 8;

export function SceneryAttribution(props: {
  readonly photo: SceneryPhoto;
  /** Extra offset above the platform bottom dock for overlaying chrome such
   *  as the pre-Liquid-Glass 44pt home toolbar or the Android new-task FAB.
   *  Do not pass composer height — Thread Detail reserves that slot via
   *  composerBottomInset and keeps safe-area docking. */
  readonly bottomExtra?: number;
  /**
   * Liquid Glass Home only: dock 8pt above the physical bottom so the pill
   * sits under the floating search/compose chrome (which already clears the
   * home indicator). Leave unset everywhere else so Thread Detail and
   * pre-Liquid-Glass Home stay above the safe-area inset.
   */
  readonly dockUnderFloatingChrome?: boolean;
  /** Painted pill height after layout, including Dynamic Type. */
  readonly onHeightChange?: (height: number) => void;
}) {
  const { photo } = props;
  const insets = useSafeAreaInsets();
  const isDarkMode = useColorScheme() !== "light";
  const reportedHeightRef = useRef(0);
  // Default: clear the home-indicator / system-nav inset. Liquid Glass Home
  // opts into a physical-bottom dock under its floating chrome.
  const bottom =
    props.dockUnderFloatingChrome === true
      ? SCENERY_CREDIT_MIN_BOTTOM + (props.bottomExtra ?? 0)
      : Math.max(insets.bottom, SCENERY_CREDIT_MIN_BOTTOM) + (props.bottomExtra ?? 0);
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
    <View
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFill,
        {
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: bottom,
          paddingHorizontal: Math.max(insets.left, insets.right, 12),
        },
      ]}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Wallpaper: ${photo.name}. Photo by ${photo.photographerName} on Unsplash.`}
        onLayout={handleLayout}
        onPress={() => void Linking.openURL(profileURL).catch(() => undefined)}
        style={({ pressed }) => ({
          maxWidth: "100%",
          opacity: pressed ? 0.7 : 1,
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
