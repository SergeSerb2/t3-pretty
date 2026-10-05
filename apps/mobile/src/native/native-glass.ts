import { Platform } from "react-native";

import { iosMajorVersion, supportsNativeLiquidGlass } from "../lib/native-glass-capability";

// Do not call expo-glass-effect here. The native probe can abort the process
// before try/catch in readNativeLiquidGlassCapability can recover. Home glass
// stays off until the RNS patch re-enables item-group / glass construction.
export const NATIVE_LIQUID_GLASS_SUPPORTED = supportsNativeLiquidGlass(
  Platform.OS,
  false,
  Platform.Version,
);

/**
 * Navigation bars stay transparent so the scenery runs edge to edge under
 * them, and UIKit's scroll-edge effect keeps titles legible over scrolled
 * content. That is a plain transparent bar appearance, not Liquid Glass
 * chrome, so it stays on while the kill switch above holds. Scroll-edge
 * effects start at iOS 26; earlier versions keep the opaque bar.
 */
export const TRANSPARENT_NATIVE_HEADERS =
  Platform.OS === "ios" && iosMajorVersion(Platform.OS, Platform.Version) >= 26;
