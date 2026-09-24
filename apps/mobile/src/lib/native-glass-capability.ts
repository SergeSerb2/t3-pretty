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
 * GlassView) is off on every iOS version.
 *
 * Origin #690 already disabled the mail toolbar and iOS 27 glass, but TestFlight
 * 161 still aborted on launch. That IPA embeds #690, so JS never sent
 * mailSearchToolbar. The patched RNS header still applies UINavigationItemStyle
 * (default Navigator, or Editor from iOS 26 glass / SOLID_HEADER_OPTIONS) and
 * can construct UIGlassEffect / glassButtonConfiguration before React runs.
 * Those selectors can exist on an Xcode 27 binary and still kill the process.
 *
 * Keep this off until the native patch re-enables
 * `RNSAllowsPatchedLiquidGlassChrome` after a proven IPA.
 */
export function supportsNativeLiquidGlass(
  _platform: string,
  _nativeCapabilityAvailable: boolean,
  _osVersion: number | string,
): boolean {
  return false;
}
