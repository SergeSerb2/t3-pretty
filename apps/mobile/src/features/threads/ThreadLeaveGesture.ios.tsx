import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useCallback, type ReactNode } from "react";
import { View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";

import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useWorkspaceListNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import { shouldLeaveThreadOnSwipe } from "./thread-leave-swipe";

/** Allows intentional right swipes across the thread content. */
export function ThreadLeaveGesture(props: { readonly children: ReactNode }) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { layout } = useAdaptiveWorkspaceLayout();
  const returnToList = useWorkspaceListNavigation("threads");
  const leaveThread = useCallback(() => {
    if (navigation.isFocused() && !layout.usesSplitView) returnToList();
  }, [layout.usesSplitView, navigation, returnToList]);
  const gesture = usePanGesture({
    enabled: focused && !layout.usesSplitView,
    activeOffsetX: 20,
    failOffsetX: -12,
    failOffsetY: [-12, 12],
    maxPointers: 1,
    onDeactivate: (event) => {
      "worklet";
      if (shouldLeaveThreadOnSwipe(event)) scheduleOnRN(leaveThread);
    },
  });

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={{ flex: 1 }}>
        {props.children}
      </View>
    </GestureDetector>
  );
}
