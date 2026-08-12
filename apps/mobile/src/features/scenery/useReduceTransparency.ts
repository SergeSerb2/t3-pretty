import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * iOS "Reduce Transparency" — mirrors the web's prefers-reduced-transparency
 * gate, which disables the photo layer and frosted chrome.
 */
export function useReduceTransparency(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then(setReduceTransparency)
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReduceTransparency,
    );
    return () => subscription.remove();
  }, []);
  return reduceTransparency;
}
