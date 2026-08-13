/** Horizontal inset shared by the home header and compact thread list. */
export const HOME_HORIZONTAL_INSET = 20;

/** Compensates for the tighter native sidebar title margin on iPad. */
export const IPAD_HOME_TITLE_OFFSET = 10;

/** Compact UINavigationBar height, excluding the status-bar safe area. */
export const IOS_COMPACT_NAVIGATION_BAR_HEIGHT = 44;

/**
 * Top inset for screen chrome that is not inside a primary scroll view when
 * the native stack header is transparent (liquid glass). Opaque headers
 * already consume this space in the navigator layout, so this is 0 then.
 */
export function nativeGlassHeaderOverlapInset(input: {
  readonly glassSupported: boolean;
  readonly headerHeight?: number | null;
  readonly safeAreaTop: number;
}): number {
  if (!input.glassSupported) return 0;
  if (input.headerHeight != null && input.headerHeight > 0) {
    return input.headerHeight;
  }
  return input.safeAreaTop + IOS_COMPACT_NAVIGATION_BAR_HEIGHT;
}
