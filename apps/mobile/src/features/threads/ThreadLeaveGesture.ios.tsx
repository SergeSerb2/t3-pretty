import { useIsFocused, useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, type ReactNode } from "react";
import { View } from "react-native";
import {
  GestureDetector,
  usePanGesture,
  type PanGestureActiveEvent,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { SymbolView } from "../../components/AppSymbol";
import { MOTION_PRESS_SPRING } from "../../lib/motion";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useWorkspaceListNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import { shouldLeaveThreadOnSwipe, THREAD_LEAVE_SWIPE_DISTANCE } from "./thread-leave-swipe";

/** Allows intentional right swipes across the thread content. */
export function ThreadLeaveGesture(props: { readonly children: ReactNode }) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { layout } = useAdaptiveWorkspaceLayout();
  const enabled = focused && !layout.usesSplitView;
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const committed = useSharedValue(false);
  const returnToList = useWorkspaceListNavigation("threads");

  useEffect(() => {
    progress.set(0);
    committed.set(!enabled);
  }, [committed, enabled, progress]);

  const leaveThread = useCallback(() => {
    if (!navigation.isFocused() || layout.usesSplitView) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    returnToList();
  }, [layout.usesSplitView, navigation, returnToList]);

  const commitSwipe = () => {
    "worklet";
    if (committed.get()) return;
    committed.set(true);
    progress.set(withSpring(1, MOTION_PRESS_SPRING));
    // Start the native pop now; never wait for the feedback animation to finish.
    scheduleOnRN(leaveThread);
  };
  const updateSwipe = (event: PanGestureActiveEvent) => {
    "worklet";
    if (committed.get()) return;
    progress.set(Math.max(0, Math.min(event.translationX / THREAD_LEAVE_SWIPE_DISTANCE, 1)));
    if (shouldLeaveThreadOnSwipe(event, "drag")) commitSwipe();
  };
  const gesture = usePanGesture({
    enabled,
    activeOffsetX: 20,
    failOffsetX: -12,
    failOffsetY: [-12, 12],
    maxPointers: 1,
    onActivate: updateSwipe,
    onUpdate: updateSwipe,
    onDeactivate: (event) => {
      "worklet";
      if (committed.get()) return;
      if (shouldLeaveThreadOnSwipe(event, "release")) commitSwipe();
      else progress.set(withSpring(0, MOTION_PRESS_SPRING));
    },
  });

  // A small nudge previews the action; UIKit still owns the screen transition.
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: reducedMotion ? 0 : progress.get() * 8 }],
  }));
  const cueStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [
      { translateX: reducedMotion ? 0 : (progress.get() - 1) * 24 },
      { scale: reducedMotion ? 1 : 0.9 + progress.get() * 0.1 },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={{ flex: 1 }}>
        <Animated.View style={[{ flex: 1 }, contentStyle]}>{props.children}</Animated.View>
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          style={[{ position: "absolute", top: "50%", left: 12, marginTop: -22 }, cueStyle]}
        >
          <View className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card shadow-sm">
            <SymbolView
              name="chevron.left"
              size={20}
              weight="semibold"
              tintColorClassName="accent-foreground"
            />
          </View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
