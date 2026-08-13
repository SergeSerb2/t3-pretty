/** Rows appearing this soon after a thread switch seed silently. */
export const SILENT_WINDOW_MS = 600;
/** Rows mounting above the furthest seen content are history, not news. */
export const SEEN_TOP_SLACK_PX = 8;
export const STAGGER_MS = 40;
export const STAGGER_CAP = 3;
/**
 * Rise is 220ms plus at most three stagger steps. A hard cap still clears
 * `scenery-row-enter` if `animationend` never fires (0-duration kill switch,
 * view-transition hiding, or a recycled node).
 */
export const ENTER_CLEAR_MS = 500;

export const ENTER_CLASS = "scenery-row-enter";
export const ENTER_DELAY_PROP = "--sc-enter-delay";

/**
 * The first timeline paint after a thread change must not animate. Loading
 * often takes longer than {@link SILENT_WINDOW_MS}, and `animation-fill-mode:
 * both` holds those rows at opacity 0 until the animation finishes. If
 * `animationend` never fires, the thread stays visually empty.
 */
export function shouldDeferThreadSeed(firstPaintForThread: boolean, wrapperCount: number): boolean {
  return firstPaintForThread && wrapperCount === 0;
}

export function shouldAnimateRowArrival(input: {
  readonly firstPaintForThread: boolean;
  readonly silentWindowActive: boolean;
  readonly inkTransitionActive: boolean;
  readonly noTransitions: boolean;
  readonly top: number;
  readonly maxSeenTop: number;
}): boolean {
  if (
    input.firstPaintForThread ||
    input.silentWindowActive ||
    input.inkTransitionActive ||
    input.noTransitions
  ) {
    return false;
  }
  return input.top >= input.maxSeenTop - SEEN_TOP_SLACK_PX;
}

export function enterDelayMs(batchIndex: number): number {
  return Math.min(batchIndex, STAGGER_CAP) * STAGGER_MS;
}

export function isSceneryInkTransitionActive(root: HTMLElement): boolean {
  return root.dataset.sceneryInkTransition === "true";
}
