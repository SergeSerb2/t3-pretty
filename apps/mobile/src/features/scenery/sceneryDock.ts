/**
 * Shared bottom-dock math for World Scenery credits and the floating chrome
 * they sit under (thread composer, Liquid Glass home search).
 *
 * iOS Liquid Glass bars are meant to rest in the home-indicator strip, like
 * Mail's search field. Using the full safe-area inset as padding leaves a
 * dead band between the credit pill and the physical bottom.
 */

/** Unscaled first-frame estimate (4pt padding + 14pt type). Callers use this
 *  until onHeightChange reports the painted size, which grows with Dynamic
 *  Type. */
export const SCENERY_CREDIT_HEIGHT = 22;
/** Gap between the credit pill and overlaying chrome. */
export const SCENERY_CREDIT_GAP = 6;
/**
 * Gap above the physical bottom edge for floating chrome and for credits
 * docked under that chrome (`dockUnderFloatingChrome`).
 */
export const SCENERY_CREDIT_MIN_BOTTOM = 8;

export function deriveFloatingChromeBottomInset(input: {
  readonly isAtKeyboardEdge: boolean;
  readonly platform: "ios" | "android";
  readonly safeAreaBottom: number;
  readonly creditHeight: number;
}): number {
  if (input.isAtKeyboardEdge) {
    return 0;
  }
  const dock =
    input.platform === "ios" ? SCENERY_CREDIT_MIN_BOTTOM : Math.max(input.safeAreaBottom, 12);
  return dock + input.creditHeight;
}

/** Resting offset from the physical bottom for the native Mail search toolbar. */
export function deriveMailSearchToolbarBottomSpacing(hasSceneryCredit: boolean): number {
  return (
    SCENERY_CREDIT_MIN_BOTTOM + (hasSceneryCredit ? SCENERY_CREDIT_HEIGHT + SCENERY_CREDIT_GAP : 0)
  );
}
