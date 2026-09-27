export { iosMajorVersion } from "../../lib/native-glass-capability";

/**
 * The patched mail toolbar constructs UIGlassEffect and
 * glassButtonConfiguration on the first Home frame with no
 * respondsToSelector. TestFlight 163 still aborted after #708 gated those
 * constructors, because native still assigned item groups / sharesBackground.
 * Home already falls back to headerSearchBarOptions + NativeHeaderToolbar.
 * Keep this off until `RNSAllowsPatchedLiquidGlassChrome` is re-enabled.
 */
export function isNativeMailSearchToolbarSupported(
  _liquidGlassSupported: boolean,
  _os: string,
  _version: number | string,
): boolean {
  return false;
}
