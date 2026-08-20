import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * iOS / Android "Reduce Motion" — parks scenery 3D tilt the same way the web
 * parks pointer parallax under prefers-reduced-motion.
 */
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
