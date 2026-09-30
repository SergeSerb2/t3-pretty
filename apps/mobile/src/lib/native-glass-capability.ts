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
 * #690 disabled the mail toolbar in JS. #708 gated native UIGlassEffect /
 * glassButtonConfiguration / UINavigationItemStyle. TestFlight 163 still
 * aborted on open: the same apply path assigned leadingItemGroups /
 * trailingItemGroups / sharesBackground, and UIKit 26+ constructs glass for
 * those groups before Expo Updates can run. Keep this off until the native
 * kill-switch is re-enabled after a proven IPA.
 */
export function supportsNativeLiquidGlass(
  _platform: string,
  _nativeCapabilityAvailable: boolean,
  _osVersion: number | string,
): boolean {
  return false;
}
