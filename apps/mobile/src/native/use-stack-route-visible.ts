import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { NativeWorkspaceTabActivityContext } from "./v5-workspace-context";

const getAppIsActive = () => AppState.currentState === "active";
function subscribeAppState(onChange: () => void) {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

/**
 * Native appear/disappear events include visible split panes and presenting
 * routes under form sheets. Focus alone would pause those visible routes.
 */
export function useStackRouteVisible(): boolean {
  const navigation = useNavigation<NativeStackNavigationProp<ReactNavigation.RootParamList>>();
  const [visible, setVisible] = useState(() => navigation.isFocused());
  const appIsActive = useSyncExternalStore(subscribeAppState, getAppIsActive);
  const tabActivity = useContext(NativeWorkspaceTabActivityContext);
  useEffect(() => {
    const show = () => setVisible(true);
    // A back swipe must get fresh content before its reveal animation.
    const removeStart = navigation.addListener("transitionStart", ({ data }) => {
      if (!data.closing) show();
    });
    const removeEnd = navigation.addListener("transitionEnd", ({ data }) => {
      if (data.closing) setVisible(false);
    });
    // Dismissing a sheet can focus a route without another native appear event.
    const removeFocus = navigation.addListener("focus", show);
    return () => {
      removeStart();
      removeEnd();
      removeFocus();
    };
  }, [navigation]);
  return visible && appIsActive && (tabActivity?.active ?? true);
}
