import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * iOS / Android "Reduce Motion" — parks scenery 3D tilt the same way the web
 * parks pointer parallax under prefers-reduced-motion.
 *
 * Unknown starts parked. A false default would mount the gyro layer for a
 * frame (or keep it subscribed) before AccessibilityInfo resolves.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => setReduceMotion(true));
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);
  return reduceMotion;
}
