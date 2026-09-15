import { isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Platform } from "react-native";

import {
  readNativeLiquidGlassCapability,
  supportsNativeLiquidGlass,
} from "../lib/native-glass-capability";

export const NATIVE_LIQUID_GLASS_SUPPORTED = supportsNativeLiquidGlass(
  Platform.OS,
  readNativeLiquidGlassCapability(isGlassEffectAPIAvailable),
);
