import Animated from "react-native-reanimated";

import { AppText as Text } from "./AppText";
import { enterFadeDown, exitFade, layoutSettle } from "../lib/motion";

export function ErrorBanner(props: { readonly message: string }) {
  return (
    <Animated.View
      entering={enterFadeDown}
      exiting={exitFade}
      layout={layoutSettle}
      className="rounded-2xl border border-rose-300/70 bg-rose-100/80 px-3.5 py-3 dark:border-rose-400/28 dark:bg-rose-500/12"
    >
      <Text className="font-t3-medium text-sm text-rose-700 dark:text-rose-300">
        {props.message}
      </Text>
    </Animated.View>
  );
}
