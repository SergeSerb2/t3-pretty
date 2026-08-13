import { deriveFloatingChromeBottomInset } from "../scenery/sceneryDock";

/**
 * Bottom padding inside the floating composer: home-indicator / nav clearance
 * plus the scenery-credit strip. Both drop away when the composer is at the
 * keyboard edge so the pill can sit flush on the IME.
 *
 * Dock math comes from `deriveFloatingChromeBottomInset` so thread chrome
 * matches Liquid Glass Home on iOS. Scenery also keys off keyboard visibility:
 * iOS focus can flicker during a stream while the IME is still up, and showing
 * the credit then jumps the composer. Visibility-false + not-at-edge is the
 * resting dock.
 */
export function deriveComposerBottomInset(input: {
  readonly atKeyboardEdge: boolean;
  readonly keyboardVisible: boolean;
  readonly platform: "ios" | "android";
  readonly safeAreaBottom: number;
  readonly sceneryCreditHeight: number;
}): number {
  const showSceneryCredit =
    input.sceneryCreditHeight > 0 && !input.keyboardVisible && !input.atKeyboardEdge;
  return deriveFloatingChromeBottomInset({
    isAtKeyboardEdge: input.atKeyboardEdge,
    platform: input.platform,
    safeAreaBottom: input.safeAreaBottom,
    creditHeight: showSceneryCredit ? input.sceneryCreditHeight : 0,
  });
}

/**
 * KeyboardChatScrollView pads the thread by the animated IME height.
 * KeyboardStickyView `enabled={false}` drops the composer translation when
 * visibility says the keyboard is closed. If height is still stale, the list
 * keeps a phantom gap unless that padding is cancelled here.
 *
 * `keyboardTranslateY` is the Reanimated keyboard height (negative while open).
 */
export function deriveStaleKeyboardPaddingCancel(input: {
  readonly translationEnabled: boolean;
  readonly keyboardTranslateY: number;
}): number {
  if (input.translationEnabled) {
    return 0;
  }
  return 0 - Math.max(0, -input.keyboardTranslateY);
}

/**
 * Pad a flex column by the live IME height. Unlike KeyboardAvoidingView's
 * view-position overlap math, this does not depend on measureInWindow — which
 * under-lifts on screens pushed inside an iOS formSheet.
 *
 * `keyboardTranslateY` is the Reanimated keyboard height (negative while open).
 */
export function deriveKeyboardAvoidPadding(input: {
  readonly visible: boolean;
  readonly keyboardTranslateY: number;
}): number {
  if (!input.visible) {
    return 0;
  }
  return Math.max(0, -input.keyboardTranslateY);
}
