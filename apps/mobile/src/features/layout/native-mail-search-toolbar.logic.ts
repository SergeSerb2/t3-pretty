export { iosMajorVersion } from "../../lib/native-glass-capability";

/**
 * The patched mail toolbar constructs UIGlassEffect and
 * glassButtonConfiguration on the first Home frame with no
 * respondsToSelector. TestFlight 159/161 aborted on that path even after
 * Origin #690 disabled this JS flag, because native still applied
 * UINavigationItemStyle. Home already falls back to headerSearchBarOptions +
 * NativeHeaderToolbar. Keep this off until
 * `RNSAllowsPatchedLiquidGlassChrome` is re-enabled.
 */
export function isNativeMailSearchToolbarSupported(
  _liquidGlassSupported: boolean,
  _os: string,
  _version: number | string,
): boolean {
  return false;
}
