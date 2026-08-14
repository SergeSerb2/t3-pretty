/**
 * The swap decision SceneryLayer makes when the target photo changes: whether
 * the photo currently on screen dissolves immediately or is held until the
 * incoming one has decoded. Split from the component so the thread-switch
 * contract stays testable without a DOM.
 *
 * A thread switch (new photo id) demotes the outgoing photo to the dissolving
 * underlay the moment the route changes — holding it at full opacity through
 * the download read as a glitchy flash of the thread being left. Blur-only
 * swaps (same photo, new CDN variant) and reduced motion keep the hold: the
 * old variant stays put until the decoded one can replace it in one step.
 */

/** What to do with the photo on screen when a new target photo arrives. */
export type ScenerySwapPlan =
  /** Demote it to the fade-out underlay now; the swap animates during the load. */
  | "demote-now"
  /** Keep it at full opacity until the incoming photo has decoded. */
  | "hold"
  /** Nothing on screen to transition from (or already showing the target). */
  | "none";

export function planScenerySwap(options: {
  readonly current: { readonly id: string; readonly blur: number } | null;
  readonly photoId: string;
  readonly blur: number;
  readonly reducedMotion: boolean;
}): ScenerySwapPlan {
  const { current, photoId, blur, reducedMotion } = options;
  if (current === null || (current.id === photoId && current.blur === blur)) {
    return "none";
  }
  if (current.id !== photoId && !reducedMotion) {
    return "demote-now";
  }
  return "hold";
}
