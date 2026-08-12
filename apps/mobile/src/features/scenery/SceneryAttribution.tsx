/**
 * Unsplash attribution pill for the World Scenery photo behind a screen —
 * "Location · Photo by X", tapping through to the photographer's profile with
 * the required utm parameters. Docked to the screen's bottom-right corner
 * (desktop uses the same corner via --scenery-dock-block) so it sits below
 * chat bubbles and list rows instead of covering them.
 */
import * as Linking from "expo-linking";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { UNSPLASH_UTM, type SceneryPhoto } from "./sceneryLogic";

/**
 * Physical-bottom offset on iOS. The composer and home toolbar already pad
 * by the home-indicator inset, so using that inset here parked the pill on
 * top of the last chat rows / thread titles. 8pt tucks it into the
 * bottom-right corner, below that chrome. Android still clears the system
 * nav bar.
 */
const IOS_CREDIT_BOTTOM = 8;

export function SceneryAttribution(props: { readonly photo: SceneryPhoto }) {
  const { photo } = props;
  const insets = useSafeAreaInsets();
  const bottom = Platform.OS === "ios" ? IOS_CREDIT_BOTTOM : Math.max(insets.bottom, 8);
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
          right: Math.max(insets.right, 12),
          bottom,
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
