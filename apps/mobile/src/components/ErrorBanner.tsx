import Animated from "react-native-reanimated";

import { AppText as Text } from "./AppText";
import { enterFadeDown, exitFade, layoutSettle } from "../lib/motion";

export function ErrorBanner(props: { readonly message: string }) {
  return (
    <Animated.View
      entering={enterFadeDown}
      exiting={exitFade}
      layout={layoutSettle}
      className="rounded-2xl border border-adaptive-rose-300-a70-400-a28 bg-adaptive-rose-100-a80-500-a12 px-3.5 py-3"
    >
      <Text className="font-t3-medium text-sm text-adaptive-rose-700-300">
        {props.message}
      </Text>
    </Animated.View>
  );
}
