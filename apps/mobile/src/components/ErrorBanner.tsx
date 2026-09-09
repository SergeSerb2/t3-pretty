import Animated from "react-native-reanimated";

import { AppText as Text } from "./AppText";
import { enterFadeDown, exitFade, layoutSettle } from "../lib/motion";

export function ErrorBanner(props: { readonly message: string }) {
  return (
    <View className="rounded-2xl border border-danger-border bg-danger px-3.5 py-3">
      <Text className="font-t3-medium text-sm text-danger-foreground">{props.message}</Text>
    </View>
  );
}
