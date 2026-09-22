import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { RemoteClientConnectionState } from "../../lib/connection";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { themeColorWithAlpha, type MobileThemeVariables } from "../../lib/mobileTheme";

export type ConnectionStatusDotState = RemoteClientConnectionState;

function statusDotTone(
  state: ConnectionStatusDotState,
  theme: MobileThemeVariables,
  dark: boolean,
): {
  readonly dotColor: string;
  readonly haloColor: string;
} {
  switch (state) {
    // Unsupported is not a failure: the machine is fine, this build just
    // cannot talk to it, so it wears the same neutral dot as "available".
    case "available":
    case "unsupported":
      return {
        dotColor: theme["--color-icon-muted"],
        haloColor: themeColorWithAlpha(theme["--color-icon-muted"], 0.42),
      };
    case "connected":
      return {
        dotColor: dark ? "#34d399" : "#059669",
        haloColor: themeColorWithAlpha(dark ? "#34d399" : "#059669", 0.48),
      };
    case "connecting":
    case "reconnecting":
      return {
        dotColor: theme["--color-warning-foreground"],
        haloColor: themeColorWithAlpha(theme["--color-warning-foreground"], 0.5),
      };
    case "offline":
    case "error":
      return {
        dotColor: theme["--color-danger-foreground"],
        haloColor: themeColorWithAlpha(theme["--color-danger-foreground"], 0.48),
      };
  }
}

function usePulseAnimation(pulse: boolean) {
  const pulseProgress = useSharedValue(0);
  const pulseActive = useSharedValue(pulse ? 1 : 0);

  useEffect(() => {
    if (pulse) {
      pulseActive.value = withTiming(1, {
        duration: 180,
        easing: Easing.out(Easing.quad),
      });
      pulseProgress.value = withRepeat(
        withTiming(1, {
          duration: 1100,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        }),
        -1,
        false,
      );
      return () => {
        cancelAnimation(pulseProgress);
      };
    }

    cancelAnimation(pulseProgress);
    pulseActive.value = withTiming(0, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
    pulseProgress.value = withTiming(0, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
  }, [pulse, pulseActive, pulseProgress]);

  return { pulseProgress, pulseActive };
}

export function ConnectionStatusDot(props: {
  readonly state: ConnectionStatusDotState;
  readonly pulse: boolean;
  readonly size?: number;
}) {
  const { pulseProgress, pulseActive } = usePulseAnimation(props.pulse);
  const { themeAppearance, themeVariables } = useAppearancePreferences();
  const tone = statusDotTone(props.state, themeVariables, themeAppearance === "dark");
  const dotSize = props.size ?? 10;
  const haloSize = dotSize + 4;
  const containerSize = haloSize + 4;

  // Worklet reads shared values only, so parent re-renders don't rebuild it.
  const haloStyle = useAnimatedStyle(() => ({
    opacity: pulseActive.value * (0.14 + (1 - pulseProgress.value) * 0.3),
    transform: [{ scale: 0.78 + pulseProgress.value * 1.16 }],
  }));

  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          haloStyle,
          {
            position: "absolute",
            width: haloSize,
            height: haloSize,
            borderRadius: haloSize / 2,
            backgroundColor: tone.haloColor,
          },
        ]}
      />
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: tone.dotColor,
        }}
      />
    </View>
  );
}
