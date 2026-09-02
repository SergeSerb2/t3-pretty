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

export type ConnectionStatusDotState = RemoteClientConnectionState;

function statusDotTone(state: ConnectionStatusDotState): {
  readonly dotColor: string;
  readonly haloColor: string;
} {
  switch (state) {
    case "available":
      return {
        dotColor: "#9ca3af",
        haloColor: "rgba(156,163,175,0.42)",
      };
    case "connected":
      return {
        dotColor: "#34d399",
        haloColor: "rgba(52,211,153,0.48)",
      };
    case "connecting":
    case "reconnecting":
      return {
        dotColor: "#f59e0b",
        haloColor: "rgba(245,158,11,0.5)",
      };
    case "offline":
    case "error":
      return {
        dotColor: "#ef4444",
        haloColor: "rgba(239,68,68,0.48)",
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
  const tone = statusDotTone(props.state);
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
