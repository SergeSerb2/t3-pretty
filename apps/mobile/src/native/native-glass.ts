import { isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Platform } from "react-native";

import { supportsNativeLiquidGlass } from "../lib/native-glass-capability";

function nativeGlassEffectApiAvailable(): boolean {
  try {
    return isGlassEffectAPIAvailable();
  } catch {
    // expo-glass-effect reads a native constant. If the module is missing or
    // the beta selector check throws, treat glass as unavailable rather than
    // aborting JS before the root component mounts.
    return false;
  }
}

export const NATIVE_LIQUID_GLASS_SUPPORTED = supportsNativeLiquidGlass(
  Platform.OS,
  nativeGlassEffectApiAvailable(),
);
