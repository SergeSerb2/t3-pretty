import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * iOS "Reduce Transparency" — mirrors the web's prefers-reduced-transparency
 * gate, which disables the photo layer and frosted chrome.
 */
export function useReduceTransparency(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    let active = true;
    let nativeChangeGeneration = 0;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      (enabled) => {
        nativeChangeGeneration += 1;
        if (active) {
          setReduceTransparency(enabled);
        }
      },
    );
    const initialGeneration = nativeChangeGeneration;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (active && nativeChangeGeneration === initialGeneration) {
          setReduceTransparency(enabled);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduceTransparency;
}
