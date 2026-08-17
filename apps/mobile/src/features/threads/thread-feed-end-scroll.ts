/**
 * Resting composer clearance in the thread list footer.
 *
 * With automatic iOS insets, UIKit already adds the home-indicator strip, so
 * the footer only reserves the overlap above that strip.
 */
export function deriveThreadFeedListFooterInset(input: {
  readonly usesNativeAutomaticInsets: boolean;
  readonly composerOverlayHeight: number;
  readonly safeAreaBottom: number;
}): number {
  if (!Number.isFinite(input.composerOverlayHeight) || input.composerOverlayHeight <= 0) {
    return 0;
  }
  if (!input.usesNativeAutomaticInsets) {
    return input.composerOverlayHeight;
  }
  return Math.max(0, input.composerOverlayHeight - Math.max(0, input.safeAreaBottom));
}

/**
 * Programmatic end offset for a chat list under a transparent iOS header.
 *
 * Native top-rest is `-headerInset`. That is the start, not the end, once
 * `alignItemsAtEnd` pads a short thread up to the viewport — the last rows
 * then sit one header-height below the fold / under the composer.
 */
export function resolveThreadFeedEndOffset(input: {
  readonly contentSize: number;
  readonly scrollLength: number;
  readonly insetStartAdjustment: number;
  readonly insetEnd: number;
}): number {
  const insetStart = Math.max(0, input.insetStartAdjustment);
  const insetEnd = Math.max(0, input.insetEnd);
  return Math.max(-insetStart, input.contentSize - input.scrollLength + insetEnd);
}
