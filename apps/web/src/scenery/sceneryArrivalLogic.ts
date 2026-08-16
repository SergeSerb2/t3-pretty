/**
 * New-thread arrival choreography for World Scenery. The sequence is a rare
 * first look at a place, not a per-keystroke animation: fog holds briefly,
 * the location name travels down into the composer, then the overlay unmounts
 * so nothing keeps painting.
 */

export type SceneryArrivalPhase = "idle" | "fog" | "reveal" | "settled";

export const SCENERY_ARRIVAL = {
  /** Beat of full fog before the veil starts to lift. */
  fogHoldMs: 420,
  /** Veil opacity/transform. */
  fogClearMs: 520,
  /** Location name travel from viewport center into the composer slot. */
  locationTravelMs: 480,
  /** Headline + composer fade/slide after the veil starts lifting. */
  chromeInMs: 300,
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

export function shouldPlaySceneryArrival(input: {
  readonly placement: "hero" | "docked" | null;
  readonly threadKey: string | null;
  readonly hasPhoto: boolean;
  readonly reducedMotion: boolean;
  readonly motionEnabled: boolean;
  readonly alreadyPlayed: boolean;
}): boolean {
  return (
    input.placement === "hero" &&
    input.threadKey !== null &&
    input.hasPhoto &&
    !input.reducedMotion &&
    input.motionEnabled &&
    !input.alreadyPlayed
  );
}

export function sceneryArrivalSettleAtMs(): number {
  return (
    SCENERY_ARRIVAL.fogHoldMs +
    Math.max(SCENERY_ARRIVAL.locationTravelMs, SCENERY_ARRIVAL.fogClearMs)
  );
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

export function measureCenterDelta(
  from: Pick<DOMRect, "left" | "top" | "width" | "height">,
  to: Pick<DOMRect, "left" | "top" | "width" | "height">,
): { readonly dx: number; readonly dy: number } {
  return {
    dx: to.left + to.width / 2 - (from.left + from.width / 2),
    dy: to.top + to.height / 2 - (from.top + from.height / 2),
  };
}
