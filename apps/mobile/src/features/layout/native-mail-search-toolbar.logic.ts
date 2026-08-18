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
 * iOS 27 betas have churned UIGlassEffect / glassButtonConfiguration.
 * The patched mail toolbar constructs both on the first Home frame, so a
 * missing selector kills the process before React or expo-updates can recover.
 */
export function isNativeMailSearchToolbarSupported(
  liquidGlassSupported: boolean,
  os: string,
  version: number | string,
): boolean {
  return liquidGlassSupported && os === "ios" && iosMajorVersion(os, version) < 27;
}
