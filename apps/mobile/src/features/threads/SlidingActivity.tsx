import { useIsFocused } from "@react-navigation/native";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
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
  duration: 260,
  easing: Easing.bezier(0.32, 0.72, 0, 1),
  reduceMotion: ReduceMotion.System,
};

function subscribeAppState(onChange: () => void) {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

const getAppState = () => AppState.currentState;

/**
 * Animate tool replacement within the mounted live slot, never list remounts.
 * `text` is the rendered label: a new call with unchanged text swaps in place.
 */
export function SlidingActivity(props: {
  readonly activityKey: string | null;
  readonly text: string;
  readonly children: ReactNode;
}) {
  const focused = useIsFocused();
  const appState = useSyncExternalStore(subscribeAppState, getAppState);
  const reducedMotion = useReducedMotion();
  const previous = useRef(props);
  const generation = useRef(0);
  const [outgoing, setOutgoing] = useState<{ children: ReactNode; generation: number } | null>(
    null,
  );
  const incomingPosition = useSharedValue(0);
  const outgoingPosition = useSharedValue(0);
  const height = useSharedValue(0);
  const clearOutgoing = useCallback((finishedGeneration: number) => {
    setOutgoing((value) => (value?.generation === finishedGeneration ? null : value));
  }, []);

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = props;
    if (!focused || reducedMotion || props.activityKey === null || appState !== "active") {
      cancelAnimation(incomingPosition);
      cancelAnimation(outgoingPosition);
      incomingPosition.set(0);
      outgoingPosition.set(0);
      // oxlint-disable-next-line react/set-state-in-effect -- Retire the snapshot when native focus or motion eligibility changes.
      if (outgoing) setOutgoing(null);
      return;
    }
    if (
      last.activityKey === null ||
      last.activityKey === props.activityKey ||
      last.text === props.text
    )
      return;
    const nextGeneration = ++generation.current;
    setOutgoing({ children: last.children, generation: nextGeneration });
    const departingPosition = incomingPosition.get();
    cancelAnimation(incomingPosition);
    cancelAnimation(outgoingPosition);
    outgoingPosition.set(departingPosition);
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

  // Fade completes at 60% of the travel, matching web, so rows read as
  // replaced rather than scrolled.
  const incomingStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: incomingPosition.get() * height.get() }],
    opacity: Math.max(0, 1 - Math.abs(incomingPosition.get()) / 0.6),
  }));
  const outgoingStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: outgoingPosition.get() * height.get() }],
    opacity: Math.max(0, 1 - Math.abs(outgoingPosition.get()) / 0.6),
  }));

  return (
    <View
      className="min-w-0 flex-1 overflow-hidden"
      onLayout={(event) => height.set(event.nativeEvent.layout.height)}
    >
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
