import { useLayoutEffect, useRef } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { SymbolView } from "../../components/AppSymbol";
import { MOTION_TIMING } from "../../lib/motion";
import { useGlassChromeActive } from "../scenery/SceneryProvider";
import {
  ModelRowContent,
  ChoiceRowContent,
  type ModelRowProps,
  type ChoiceRowProps,
} from "./ThreadSettingsRows.shared";

/**
 * On glass the mark fades in when the selection moves onto this row. Rows are
 * recycled list cells, so a cell rebinding to another `identity` (or mounting)
 * shows its mark without replaying the fade.
 */
function SelectedCheckmark(props: { readonly selected: boolean; readonly identity: string }) {
  const glass = useGlassChromeActive();
  const opacity = useSharedValue(1);
  const previous = useRef({ selected: props.selected, identity: props.identity });
  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { selected: props.selected, identity: props.identity };
    if (!props.selected || last.selected || last.identity !== props.identity) return;
    opacity.set(0);
    opacity.set(withTiming(1, MOTION_TIMING));
  }, [opacity, props.identity, props.selected]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!props.selected) return null;
  const mark = (
    <SymbolView
      name="checkmark"
      size={16}
      tintColorClassName="accent-icon"
      type="monochrome"
      weight="semibold"
    />
  );
  return glass ? <Animated.View style={fadeStyle}>{mark}</Animated.View> : mark;
}

export function ModelRow(props: ModelRowProps) {
  return (
    <ModelRowContent
      {...props}
      labelNumberOfLines={1}
      trailingSelection={
        <SelectedCheckmark selected={props.selected} identity={props.option.key} />
      }
    />
  );
}

export function ChoiceRow(props: ChoiceRowProps) {
  return (
    <ChoiceRowContent
      {...props}
      trailingSelection={<SelectedCheckmark selected={props.selected} identity={props.label} />}
    />
  );
}
