import { useLayoutEffect } from "react";
import type { ColorValue } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { SymbolView } from "../../components/AppSymbol";

export const THREAD_DISCLOSURE_TRANSITION_MS = 180;

export function ThreadDisclosureChevron(props: {
  readonly expanded: boolean;
  readonly collapsedDirection: "right" | "down";
  readonly size: number;
  readonly tintColor: ColorValue;
}) {
  const expandedAngle = props.collapsedDirection === "right" ? 90 : 180;
  const rotation = useSharedValue(props.expanded ? expandedAngle : 0);

  useLayoutEffect(() => {
    rotation.set(
      withTiming(props.expanded ? expandedAngle : 0, {
        duration: THREAD_DISCLOSURE_TRANSITION_MS,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [expandedAngle, props.expanded, rotation]);

  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ width: props.size, height: props.size }, rotationStyle]}
    >
      <SymbolView
        name={props.collapsedDirection === "right" ? "chevron.right" : "chevron.down"}
        size={props.size}
        tintColor={props.tintColor}
        type="monochrome"
      />
    </Animated.View>
  );
}
