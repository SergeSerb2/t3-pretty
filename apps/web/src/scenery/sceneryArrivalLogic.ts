/**
 * New-thread arrival choreography for World Scenery. The sequence is a rare
 * first look at a place, not a per-keystroke animation: fog covers the
 * route change immediately, the wallpaper must be decoded under that veil,
 * then the location name travels down into the composer and the overlay
 * unmounts so nothing keeps painting.
 */

export type SceneryArrivalPhase = "idle" | "fog" | "reveal" | "settled";
export type SceneryComposerPlacement = "hero" | "docked";
export type SceneryArrivalFogInk = "dark" | "light";

export const SCENERY_ARRIVAL = {
  /**
   * Intended veil when the wallpaper is already decoded at fog-on. The bank
   * gathers over this whole beat (scenery-fog-gather runs its full length)
   * and sits at full cover the moment the reveal starts.
   */
  fogHoldMs: 460,
  /** Shortest veil after decode so the lift is over a painted photo. */
  fogHoldAfterReadyMs: 160,
  /** Give up waiting for decode and lift over whatever is on screen. */
  fogMaxWaitMs: 2400,
  /** Longest fog band's dissipation; the near band ends here (see CSS delays). */
  fogClearMs: 880,
  /** Location name travel from viewport center into the composer slot. */
  locationTravelMs: 480,
  /** Headline + composer fade/slide after the veil starts lifting. */
  chromeInMs: 420,
  /** Compact dock of the composer after the first send. */
  dockMs: 420,
  easeOutExpo: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeInOut: "cubic-bezier(0.77, 0, 0.175, 1)",
} as const;

export const SCENERY_ARRIVAL_ATTR = "sceneryArrival";
export const SCENERY_COMPOSER_ATTR = "sceneryComposer";

const playedArrivalKeys = new Set<string>();

export function hasPlayedSceneryArrival(threadKey: string): boolean {
  return playedArrivalKeys.has(threadKey);
}

export function markSceneryArrivalPlayed(threadKey: string): void {
  playedArrivalKeys.add(threadKey);
}

/** Test hook. Production code never clears a played key. */
export function resetPlayedSceneryArrivals(): void {
  playedArrivalKeys.clear();
}

export function shouldArmSceneryArrival(input: {
  readonly placement: SceneryComposerPlacement | null;
  readonly threadKey: string | null;
  readonly reducedMotion: boolean;
  readonly motionEnabled: boolean;
  readonly alreadyPlayed: boolean;
}): boolean {
  return (
    input.placement === "hero" &&
    input.threadKey !== null &&
    !input.reducedMotion &&
    input.motionEnabled &&
    !input.alreadyPlayed
  );
}

export function shouldPlaySceneryArrival(input: {
  readonly placement: SceneryComposerPlacement | null;
  readonly threadKey: string | null;
  readonly hasPhoto: boolean;
  readonly reducedMotion: boolean;
  readonly motionEnabled: boolean;
  readonly alreadyPlayed: boolean;
}): boolean {
  return shouldArmSceneryArrival(input) && input.hasPhoto;
}

/** Fog is covering the swap: the incoming photo should mount settled, no ink VT. */
export function sceneryArrivalCoversSwap(phase: SceneryArrivalPhase | null): boolean {
  return phase === "fog";
}

export function remainingFogHoldMs(fogStartedAt: number, now: number): number {
  const elapsed = Math.max(0, now - fogStartedAt);
  return Math.max(SCENERY_ARRIVAL.fogHoldAfterReadyMs, SCENERY_ARRIVAL.fogHoldMs - elapsed);
}

export function sceneryArrivalSettleAtMs(holdMs: number = SCENERY_ARRIVAL.fogHoldMs): number {
  return holdMs + Math.max(SCENERY_ARRIVAL.locationTravelMs, SCENERY_ARRIVAL.fogClearMs);
}

export function writeSceneryArrivalPhase(phase: SceneryArrivalPhase | null): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (phase === null || phase === "idle") {
    delete root.dataset[SCENERY_ARRIVAL_ATTR];
    return;
  }
  root.dataset[SCENERY_ARRIVAL_ATTR] = phase;
}

export function readSceneryArrivalPhase(): SceneryArrivalPhase | null {
  if (typeof document === "undefined") {
    return null;
  }
  const value = document.documentElement.dataset[SCENERY_ARRIVAL_ATTR];
  return value === "fog" || value === "reveal" || value === "settled" ? value : null;
}

export function writeSceneryComposerPlacement(placement: SceneryComposerPlacement | null): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (placement === null) {
    delete root.dataset[SCENERY_COMPOSER_ATTR];
    return;
  }
  if (root.dataset[SCENERY_COMPOSER_ATTR] === placement) {
    return;
  }
  root.dataset[SCENERY_COMPOSER_ATTR] = placement;
}

export function readSceneryComposerPlacement(): SceneryComposerPlacement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const value = document.documentElement.dataset[SCENERY_COMPOSER_ATTR];
  return value === "hero" || value === "docked" ? value : null;
}

export function readSceneryArrivalFogInk(): SceneryArrivalFogInk {
  if (typeof document === "undefined") {
    return "dark";
  }
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function measureCenterDelta(
  from: Pick<DOMRect, "left" | "top" | "width" | "height">,
  to: Pick<DOMRect, "left" | "top" | "width" | "height">,
): { readonly dx: number; readonly dy: number } {
  return {
    dx: to.left + to.width / 2 - (from.left + from.width / 2),
    dy: to.top + to.height / 2 - (from.top + from.height / 2),
  };
}
