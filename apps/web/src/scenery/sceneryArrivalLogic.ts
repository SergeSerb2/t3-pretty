/**
 * New-thread arrival choreography for World Scenery. The sequence is a rare
 * first look at a place, not a per-keystroke animation: fog covers the
 * route change as soon as the user asks for a new thread, the wallpaper
 * decodes under that veil, then the location name travels down into the
 * composer and the overlay unmounts so nothing keeps painting.
 */

export type SceneryArrivalPhase = "idle" | "fog" | "reveal" | "settled";
export type SceneryComposerPlacement = "hero" | "docked";
export type SceneryArrivalFogInk = "dark" | "light";

export const SCENERY_ARRIVAL = {
  /**
   * Time for the banks to reach full cover. CSS gather uses the same value.
   * Banks start already mostly opaque so the route change stays hidden.
   */
  fogGatherMs: 180,
  /**
   * Sit at full cover after the wallpaper is ready. Also the sit after gather
   * when the photo was ready at fog-on. fogHoldMs is gather plus this sit.
   */
  fogHoldAfterReadyMs: 320,
  /** Veil when the wallpaper is already decoded at fog-on (gather + sit). */
  fogHoldMs: 500,
  /** Give up waiting for decode and lift over whatever is on screen. */
  fogMaxWaitMs: 2400,
  /** Longest fog band dissipation. Chrome is already on screen during this. */
  fogClearMs: 1100,
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
const MAX_PLAYED_ARRIVAL_KEYS = 256;
const arrivalRequestListeners = new Set<() => void>();
let pendingArrivalThreadKey: string | null = null;

function notifySceneryArrivalRequest(): void {
  for (const listener of arrivalRequestListeners) {
    listener();
  }
}

export function hasPlayedSceneryArrival(threadKey: string): boolean {
  return playedArrivalKeys.has(threadKey);
}

export function markSceneryArrivalPlayed(threadKey: string): void {
  playedArrivalKeys.delete(threadKey);
  playedArrivalKeys.add(threadKey);
  if (playedArrivalKeys.size > MAX_PLAYED_ARRIVAL_KEYS) {
    const oldest = playedArrivalKeys.values().next().value;
    if (oldest !== undefined) playedArrivalKeys.delete(oldest);
  }
}

/** Test hook. Production code never clears a played key. */
export function resetPlayedSceneryArrivals(): void {
  playedArrivalKeys.clear();
  if (pendingArrivalThreadKey !== null) {
    pendingArrivalThreadKey = null;
    notifySceneryArrivalRequest();
  }
}

/**
 * Arm fog on the click that mints a new thread, before the draft route
 * paints. SceneryArrival mounts the overlay in the same layout pass.
 */
export function requestSceneryArrival(threadKey: string): void {
  if (hasPlayedSceneryArrival(threadKey) || pendingArrivalThreadKey === threadKey) {
    return;
  }
  pendingArrivalThreadKey = threadKey;
  notifySceneryArrivalRequest();
}

export function peekSceneryArrivalRequest(): string | null {
  return pendingArrivalThreadKey;
}

export function subscribeSceneryArrivalRequest(onChange: () => void): () => void {
  arrivalRequestListeners.add(onChange);
  return () => {
    arrivalRequestListeners.delete(onChange);
  };
}

export function clearSceneryArrivalRequest(threadKey: string): void {
  if (pendingArrivalThreadKey !== threadKey) {
    return;
  }
  pendingArrivalThreadKey = null;
  notifySceneryArrivalRequest();
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
  const gatherLeft = Math.max(0, SCENERY_ARRIVAL.fogGatherMs - elapsed);
  return gatherLeft + SCENERY_ARRIVAL.fogHoldAfterReadyMs;
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
