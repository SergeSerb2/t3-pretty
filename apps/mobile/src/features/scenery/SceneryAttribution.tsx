/**
 * Unsplash attribution pill for the World Scenery photo behind a screen —
 * "Location · Photo by X", tapping through to the photographer's profile with
 * the required utm parameters. The desktop theme keeps the equivalent credit
 * docked bottom-right; mobile floats it in the same corner, clear of the
 * composer/toolbar via the caller-provided bottom offset.
 */
import { isLiquidGlassSupported, LiquidGlassView } from "@callstack/liquid-glass";
import * as Linking from "expo-linking";
import { Pressable, StyleSheet, useColorScheme, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { UNSPLASH_UTM, type SceneryPhoto } from "./sceneryLogic";

export function SceneryAttribution(props: {
  readonly photo: SceneryPhoto;
  /** Distance from the screen's bottom edge so the pill clears the composer
   *  or home toolbar. */
  readonly bottom: number;
}) {
  const { photo } = props;
  const isDarkMode = useColorScheme() !== "light";
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

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Wallpaper: ${photo.name}. Photo by ${photo.photographerName} on Unsplash.`}
        onPress={() => void Linking.openURL(profileURL).catch(() => undefined)}
        style={({ pressed }) => ({
          bottom: props.bottom,
          opacity: pressed ? 0.7 : 1,
          position: "absolute",
          right: 12,
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
