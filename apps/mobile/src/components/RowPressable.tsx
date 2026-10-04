import type { ComponentProps, ReactNode } from "react";
import { Pressable } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { cn } from "../lib/cn";
import { MOTION_PRESS_SPRING, MOTION_RELEASE_TIMING } from "../lib/motion";
import { useHoverGesture } from "../lib/useHoverGesture";

// A touch may be the start of a scroll: UIKit waits this long before it
// highlights a cell, so a flick never flashes the row under the finger.
const PRESS_HIGHLIGHT_DELAY_MS = 90;

/**
 * Row press target. Pointer hover and touch both raise the interaction fill;
 * a touch lands after a short delay and fades out on release, like a table
 * cell. `pressScale` also sinks standalone cards slightly while held.
 */
export function RowPressable({
  children,
  className,
  interactionClassName = "bg-row-hover",
  interactionOpacity = 1,
  pressScale,
  onPressIn,
  onPressOut,
  ...props
}: Omit<ComponentProps<typeof Pressable>, "children"> & {
  readonly children: ReactNode;
  readonly interactionClassName?: string;
  readonly interactionOpacity?: number;
  readonly pressScale?: number;
}) {
  const { hovered, hoverGesture } = useHoverGesture(props.disabled ?? false);
  const pressed = useSharedValue(0);
  const scale = useSharedValue(1);
  const disabled = props.disabled === true;
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: disabled ? 0 : Math.max(pressed.value, hovered ? 1 : 0) * interactionOpacity,
  }));
  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pressable = (
    <GestureDetector gesture={hoverGesture}>
      <Pressable
        unstable_pressDelay={PRESS_HIGHLIGHT_DELAY_MS}
        {...props}
        className={cn("relative overflow-hidden", className)}
        onPressIn={(event) => {
          pressed.set(withTiming(1, { duration: 80 }));
          if (pressScale !== undefined) scale.set(withSpring(pressScale, MOTION_PRESS_SPRING));
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          pressed.set(withTiming(0, MOTION_RELEASE_TIMING));
          if (pressScale !== undefined) scale.set(withSpring(1, MOTION_PRESS_SPRING));
          onPressOut?.(event);
        }}
      >
        <Animated.View
          pointerEvents="none"
          className={cn("absolute inset-0", interactionClassName)}
          style={overlayStyle}
        />
        {children}
      </Pressable>
    </GestureDetector>
  );
  return pressScale === undefined ? (
    pressable
  ) : (
    <Animated.View style={scaleStyle}>{pressable}</Animated.View>
  );
}
