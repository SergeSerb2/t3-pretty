/**
 * Unsplash attribution pill for the World Scenery photo behind a screen —
 * "Location · Photo by X", tapping through to the photographer's profile with
 * the required utm parameters. Docked to the screen's bottom-right corner
 * (desktop uses the same corner via --scenery-dock-block) so it sits below
 * chat bubbles and list rows instead of covering them.
 */
import * as Linking from "expo-linking";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { UNSPLASH_UTM, type SceneryPhoto } from "./sceneryLogic";

/** Painted height of the credit pill (4pt padding + 14pt type). Callers
 *  reserve this below overlapping chrome so the pill stays tappable. */
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
}) {
  const { photo } = props;
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, SCENERY_CREDIT_MIN_BOTTOM) + (props.bottomExtra ?? 0);
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
