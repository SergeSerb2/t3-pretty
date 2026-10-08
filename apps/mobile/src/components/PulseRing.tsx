import { useEffect } from "react";
import { StyleSheet, type ColorValue } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/**
 * A ring that swells out of its parent and fades, on repeat. Only mount it
 * while something is actually in progress: it is the one idle loop allowed on
 * Home, it runs on the UI thread, and Reduce Motion turns it off.
 */
export function PulseRing(props: { readonly color: ColorValue; readonly radius: number }) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) return;
    progress.set(
      withRepeat(withTiming(1, { duration: 1700, easing: Easing.out(Easing.quad) }), -1, false),
    );
    return () => cancelAnimation(progress);
  }, [progress, reducedMotion]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 1.4 }],
  }));
  if (reducedMotion) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: props.radius, backgroundColor: props.color },
        style,
      ]}
    />
  );
}
