import { useEffect, useState } from "react";
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

import { MOTION_TIMING } from "../lib/motion";

const INDICATOR_WIDTH_FRACTION = 0.3;
const MIN_INDICATOR_WIDTH = 48;

function LoadingStripFrame(props: {
  readonly children: React.ReactNode;
  readonly onLayout?: (width: number) => void;
}) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden"
      onLayout={
        props.onLayout
          ? (event) => {
              props.onLayout?.(event.nativeEvent.layout.width);
            }
          : undefined
      }
    >
      {props.children}
    </View>
  );
}

function IndeterminateLoadingStrip() {
  const [containerWidth, setContainerWidth] = useState(0);
  const travelProgress = useSharedValue(0);
  const indicatorWidth = Math.max(MIN_INDICATOR_WIDTH, containerWidth * INDICATOR_WIDTH_FRACTION);

  useEffect(() => {
    travelProgress.value = 0;
    travelProgress.value = withSequence(
      withRepeat(
        withTiming(1, {
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          reduceMotion: ReduceMotion.System,
        }),
        3,
        false,
      ),
      withTiming(0.5, { duration: 120, reduceMotion: ReduceMotion.System }),
    );

    return () => {
      cancelAnimation(travelProgress);
    };
  }, [travelProgress]);

  const indicatorStyle = useAnimatedStyle(
    () => ({
      transform: [
        {
          translateX: (containerWidth + indicatorWidth) * travelProgress.value - indicatorWidth,
        },
      ],
      width: indicatorWidth,
    }),
    [containerWidth, indicatorWidth],
  );

  return (
    <LoadingStripFrame onLayout={setContainerWidth}>
      <Animated.View className="h-full rounded-full bg-primary" style={indicatorStyle} />
    </LoadingStripFrame>
  );
}

function DeterminateLoadingStrip(props: { readonly progress: number }) {
  const containerWidth = useSharedValue(0);
  const clampedProgress = Math.min(1, Math.max(0, props.progress));
  const progress = useSharedValue(clampedProgress);

  useEffect(() => {
    progress.value = withTiming(clampedProgress, MOTION_TIMING);
  }, [progress, clampedProgress]);

  const indicatorStyle = useAnimatedStyle(() => {
    const width = containerWidth.value;
    return {
      opacity: width > 0 ? 1 : 0,
      transform: [{ translateX: (progress.value - 1) * width }],
    };
  });

  return (
    <LoadingStripFrame
      onLayout={(width) => {
        containerWidth.value = width;
      }}
    >
      <Animated.View className="h-full w-full rounded-r-full bg-primary" style={indicatorStyle} />
    </LoadingStripFrame>
  );
}

export function LoadingStrip(props: { readonly progress?: number }) {
  if (props.progress === undefined) {
    return <IndeterminateLoadingStrip />;
  }

  return <DeterminateLoadingStrip progress={props.progress} />;
}
