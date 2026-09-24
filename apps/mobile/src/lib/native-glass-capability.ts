export function readNativeLiquidGlassCapability(checkCapability: () => boolean): boolean {
  try {
    return checkCapability();
  } catch {
    return false;
  }
}

export function iosMajorVersion(os: string, version: number | string): number {
  if (os !== "ios") {
    return 0;
  }
  if (typeof version === "number") {
    return Math.floor(version);
  }
  const major = Number.parseInt(String(version).split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : 0;
}

/**
 * Liquid-glass chrome (transparent headers, `editor` nav-item style, Expo
 * GlassView) is iOS 26 only. iOS 27 churned UIGlassEffect /
 * glassButtonConfiguration / UINavigationItemStyle; the patched RNS header
 * applies those on the first Home frame and can abort launch before React
 * recovers. An unparseable version is treated as unsafe.
 */
export function supportsNativeLiquidGlass(
  platform: string,
  nativeCapabilityAvailable: boolean,
  osVersion: number | string,
): boolean {
  const major = iosMajorVersion(platform, osVersion);
  return platform === "ios" && nativeCapabilityAvailable && major > 0 && major < 27;
}
