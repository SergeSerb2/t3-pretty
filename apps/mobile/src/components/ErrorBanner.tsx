import Animated from "react-native-reanimated";

import { AppText as Text } from "./AppText";
import { enterFade, exitFade } from "../lib/motion";
export function ErrorBanner(props: { readonly message: string }) {
  return (
    <Animated.View
      entering={enterFade}
      exiting={exitFade}
      className="rounded-2xl border border-danger-border bg-danger px-3.5 py-3"
    >
      <Text className="font-t3-medium text-sm text-danger-foreground">{props.message}</Text>
    </Animated.View>
  );
}
