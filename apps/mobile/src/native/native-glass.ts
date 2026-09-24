import { Platform } from "react-native";

import { supportsNativeLiquidGlass } from "../lib/native-glass-capability";

// Do not call expo-glass-effect here. The native probe can abort the process
// before try/catch in readNativeLiquidGlassCapability can recover. Home glass
// stays off until the RNS patch re-enables item-group / glass construction.
export const NATIVE_LIQUID_GLASS_SUPPORTED = supportsNativeLiquidGlass(
  Platform.OS,
  false,
  Platform.Version,
);
