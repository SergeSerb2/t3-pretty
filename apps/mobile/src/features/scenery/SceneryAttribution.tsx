/**
 * Unsplash attribution pill for the World Scenery photo behind a screen —
 * "Location · Photo by X", tapping through to the photographer's profile with
 * the required utm parameters. The desktop theme keeps the equivalent credit
 * docked bottom-right; mobile floats it in the same corner, clear of the
 * composer/toolbar via the caller-provided bottom offset.
 */
import * as Linking from "expo-linking";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { UNSPLASH_UTM, type SceneryPhoto } from "./sceneryLogic";

export function SceneryAttribution(props: {
  readonly photo: SceneryPhoto;
  /** Distance from the screen's bottom edge so the pill clears the composer
   *  or home toolbar. */
  readonly bottom: number;
}) {
  const { photo } = props;
  const profileURL =
    photo.photographerProfileURL !== null
      ? `${photo.photographerProfileURL}${UNSPLASH_UTM}`
      : `https://unsplash.com/${UNSPLASH_UTM}`;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Wallpaper: ${photo.name}. Photo by ${photo.photographerName} on Unsplash.`}
        onPress={() => void Linking.openURL(profileURL).catch(() => undefined)}
        style={({ pressed }) => ({
          position: "absolute",
          right: 12,
          bottom: props.bottom,
          maxWidth: 280,
          borderRadius: 999,
          backgroundColor: "rgba(0, 0, 0, 0.45)",
          paddingHorizontal: 10,
          paddingVertical: 4,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text
          numberOfLines={1}
          style={{ color: "rgba(255, 255, 255, 0.92)", fontSize: 10, lineHeight: 14 }}
        >
          {photo.name} · Photo by {photo.photographerName}
        </Text>
      </Pressable>
    </View>
  );
}
