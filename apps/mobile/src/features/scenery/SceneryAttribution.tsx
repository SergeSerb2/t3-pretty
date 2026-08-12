/**
 * Unsplash attribution pill for the World Scenery photo behind a screen —
 * "Location · Photo by X", tapping through to the photographer's profile with
 * the required utm parameters. Horizontally centered under floating chrome.
 * `dockUnderFloatingChrome` sits the pill in the home-indicator strip under
 * Liquid Glass Home search and the thread composer; otherwise the pill clears
 * the system inset (desktop still docks bottom-right via --scenery-dock-block).
 */
import { isLiquidGlassSupported, LiquidGlassView } from "@callstack/liquid-glass";
import * as Linking from "expo-linking";
import { useRef } from "react";
import { Pressable, StyleSheet, useColorScheme, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SCENERY_CREDIT_MIN_BOTTOM } from "./sceneryDock";
import { UNSPLASH_UTM, type SceneryPhoto } from "./sceneryLogic";

export {
  SCENERY_CREDIT_GAP,
  SCENERY_CREDIT_HEIGHT,
  SCENERY_CREDIT_MIN_BOTTOM,
} from "./sceneryDock";

export function SceneryAttribution(props: {
  readonly photo: SceneryPhoto;
  /** Extra offset above the platform bottom dock for overlaying chrome such
   *  as the pre-Liquid-Glass 44pt home toolbar or the Android new-task FAB.
   *  Do not pass composer height — Thread Detail reserves that slot via
   *  composerBottomInset and docks with `dockUnderFloatingChrome`. */
  readonly bottomExtra?: number;
  /**
   * Dock 8pt above the physical bottom so the pill sits under floating
   * Home search / thread compose chrome. Leave unset on pre-Liquid-Glass
   * Home and Android so the pill still clears the system inset.
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
  // and the iOS thread composer opt into a physical-bottom dock.
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
