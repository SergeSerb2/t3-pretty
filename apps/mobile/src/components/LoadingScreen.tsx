import type { ReactNode } from "react";
import { StatusBar, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppActivityIndicator } from "./AppActivityIndicator";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";

import { AppText as Text } from "./AppText";
import { BrandMark } from "./BrandMark";
import { enterFade, exitFade } from "../lib/motion";

export function LoadingScreen(props: {
  readonly message: string;
  /** Let the enclosing pane supply the background and top inset. */
  readonly embedded?: boolean;
  readonly messagePlacement?: "above-spinner" | "below-spinner";
  /** Absolute-fill layer under the content, e.g. the scenery photo. */
  readonly backdrop?: ReactNode;
}) {
  const { themeAppearance: colorScheme } = useAppearancePreferences();
  const insets = useSafeAreaInsets();
  const messagePlacement = props.messagePlacement ?? "below-spinner";

  return (
    <Animated.View
      entering={enterFade}
      exiting={exitFade}
      className={props.embedded ? "flex-1" : "flex-1 bg-screen"}
      style={{ paddingTop: props.embedded ? 0 : insets.top }}
    >
      {props.backdrop}
      <StatusBar barStyle={colorScheme === "dark" ? "light-content" : "dark-content"} />
      <View className="flex-1 items-center justify-center gap-5 px-6">
        <BrandMark compact />
        {messagePlacement === "above-spinner" ? (
          <Text className="font-t3-bold text-lg text-foreground">{props.message}</Text>
        ) : null}
        <AppActivityIndicator size="large" />
        {messagePlacement === "below-spinner" ? (
          <Text className="font-t3-bold text-lg text-foreground">{props.message}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
}
