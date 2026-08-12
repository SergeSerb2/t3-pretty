import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  FadeOutUp,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

/** Keep the send treatment on screen long enough to read, even on a fast path. */
export const COMPOSER_SEND_INDICATOR_MIN_MS = 320;

export function waitForComposerSendIndicatorMin(startedAt: number): Promise<void> {
  const remainingMs = Math.max(0, COMPOSER_SEND_INDICATOR_MIN_MS - (Date.now() - startedAt));
  if (remainingMs === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, remainingMs);
  });
}

const INDICATOR_SIZE = 20;
const STROKE_WIDTH = 2.25;
const RADIUS = (INDICATOR_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_LENGTH = CIRCUMFERENCE * 0.28;
const SPIN_DURATION_MS = 900;

const ENTER = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const EXIT = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
export const COMPOSER_SEND_ICON_EXIT = FadeOutUp.duration(160).reduceMotion(ReduceMotion.System);

/**
 * Indeterminate send progress. Rotation is transform-only; reduced motion
 * leaves a static arc instead of a looping spin.
 */
export function ComposerSendIndicator(props: { readonly color: string; readonly size?: number }) {
  const size = props.size ?? INDICATOR_SIZE;
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, {
        duration: SPIN_DURATION_MS,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.System,
      }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(rotation);
    };
  }, [rotation]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View
      entering={ENTER}
      exiting={EXIT}
      style={[{ height: size, width: size }, spinStyle]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${INDICATOR_SIZE} ${INDICATOR_SIZE}`}>
        <Circle
          cx={INDICATOR_SIZE / 2}
          cy={INDICATOR_SIZE / 2}
          fill="none"
          r={RADIUS}
          stroke={props.color}
          strokeOpacity={0.22}
          strokeWidth={STROKE_WIDTH}
        />
        <Circle
          cx={INDICATOR_SIZE / 2}
          cy={INDICATOR_SIZE / 2}
          fill="none"
          r={RADIUS}
          stroke={props.color}
          strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
          strokeLinecap="round"
          strokeWidth={STROKE_WIDTH}
        />
      </Svg>
    </Animated.View>
  );
}

export function ComposerSendIconSlot(props: {
  readonly loading: boolean;
  readonly color: string;
  readonly children: ReactNode;
}) {
  if (props.loading) {
    return <ComposerSendIndicator color={props.color} />;
  }

  return (
    <Animated.View exiting={COMPOSER_SEND_ICON_EXIT}>
      <View className="h-4 w-4 items-center justify-center">{props.children}</View>
    </Animated.View>
  );
}
