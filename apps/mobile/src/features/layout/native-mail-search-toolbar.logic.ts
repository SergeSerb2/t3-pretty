export { iosMajorVersion } from "../../lib/native-glass-capability";

/**
 * The patched mail toolbar constructs UIGlassEffect and
 * glassButtonConfiguration on the first Home frame with no
 * respondsToSelector. TestFlight 159 is the first IPA compiled with local
 * Xcode 27; that SDK/runtime churned those selectors, so an iOS 26 device
 * aborts launch the same way iOS 27 already did. Home already falls back to
 * headerSearchBarOptions + NativeHeaderToolbar. Keep this off until the RNS
 * patch guards the selectors and a new IPA ships.
 */
export function isNativeMailSearchToolbarSupported(
  _liquidGlassSupported: boolean,
  _os: string,
  _version: number | string,
): boolean {
  return false;
}
