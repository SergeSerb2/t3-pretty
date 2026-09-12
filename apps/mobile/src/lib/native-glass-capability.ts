export function readNativeLiquidGlassCapability(checkCapability: () => boolean): boolean {
  try {
    return checkCapability();
  } catch {
    return false;
  }
}

export function supportsNativeLiquidGlass(
  platform: string,
  nativeCapabilityAvailable: boolean,
): boolean {
  return platform === "ios" && nativeCapabilityAvailable;
}
