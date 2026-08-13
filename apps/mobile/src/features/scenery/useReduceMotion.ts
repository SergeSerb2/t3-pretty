import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Keeps non-Reanimated scenery transitions in step with the system setting. */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  return reduceMotion;
}
