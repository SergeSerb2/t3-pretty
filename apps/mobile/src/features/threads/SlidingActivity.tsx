import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

const HANDOFF_TIMING = {
  duration: 180,
  easing: Easing.bezier(0.23, 1, 0.32, 1),
  reduceMotion: ReduceMotion.System,
};

/** Animate tool replacement within the mounted live slot, never list remounts. */
export function SlidingActivity(props: {
  readonly activityKey: string | null;
  readonly height: number;
  readonly children: ReactNode;
}) {
  const focused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  const previous = useRef(props);
  const generation = useRef(0);
  const [outgoing, setOutgoing] = useState<{ children: ReactNode; generation: number } | null>(
    null,
  );
  const incomingPosition = useSharedValue(0);
  const outgoingPosition = useSharedValue(0);
  const clearOutgoing = useCallback((finishedGeneration: number) => {
    setOutgoing((value) => (value?.generation === finishedGeneration ? null : value));
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = props;
    if (!focused || reducedMotion || props.activityKey === null || !appActive) {
      cancelAnimation(incomingPosition);
      cancelAnimation(outgoingPosition);
      incomingPosition.set(0);
      outgoingPosition.set(0);
      if (outgoing) setOutgoing(null);
      return;
    }
    if (last.activityKey === null || last.activityKey === props.activityKey) return;
    cancelAnimation(incomingPosition);
    cancelAnimation(outgoingPosition);
    const nextGeneration = ++generation.current;
    setOutgoing({ children: last.children, generation: nextGeneration });
    outgoingPosition.set(incomingPosition.get());
    outgoingPosition.set(
      withTiming(-1, HANDOFF_TIMING, (finished) => {
        if (finished) scheduleOnRN(clearOutgoing, nextGeneration);
      }),
    );
    incomingPosition.set(1);
    incomingPosition.set(withTiming(0, HANDOFF_TIMING));
  });

  useLayoutEffect(
    () => () => {
      cancelAnimation(incomingPosition);
      cancelAnimation(outgoingPosition);
    },
    [incomingPosition, outgoingPosition],
  );

  const incomingStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: incomingPosition.get() * props.height }],
    opacity: 1 - Math.abs(incomingPosition.get()),
  }));
  const outgoingStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: outgoingPosition.get() * props.height }],
    opacity: 1 - Math.abs(outgoingPosition.get()),
  }));

  return (
    <View className="min-w-0 flex-1 overflow-hidden">
      {outgoing ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute inset-x-0 top-0 flex-row items-center gap-1.5"
          style={outgoingStyle}
        >
          {outgoing.children}
        </Animated.View>
      ) : null}
      <Animated.View className="flex-row items-center gap-1.5" style={incomingStyle}>
        {props.children}
      </Animated.View>
    </View>
  );
}
