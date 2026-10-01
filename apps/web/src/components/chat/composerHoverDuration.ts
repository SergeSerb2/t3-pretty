/** Same-point lastSpeed is only the just-sampled step, not a dwell. */
export const COMPOSER_HOVER_SPEED_STALE_MS = 100;

/** Speed EMA time constant. A flick still wins; one jittery sample does not. */
export const COMPOSER_HOVER_SPEED_TAU_MS = 48;

/**
 * Stillness before the halo finishes opening. Movement faster than
 * `COMPOSER_HOVER_TRAVEL_SPEED` postpones it, so a pass-through stays tight
 * and a hand that arrives gets the rest of the bloom.
 */
export const COMPOSER_HOVER_SETTLE_MS = 80;

/** px/ms. Above this the pointer is still traveling, not landing. */
export const COMPOSER_HOVER_TRAVEL_SPEED = 0.35;

const SPEED_SLOW = 0.08;
const SPEED_FAST = 1.8;

/** Enter reads the arrival. Fast is clearly quicker; slow wakes up, it does not stall. */
const ENTER_SLOW = 1.45;
const ENTER_FAST = 0.68;
/** Exit always answers. A fast leave shortens it; it does not pop the light off. */
const EXIT_SLOW = 1.32;
const EXIT_FAST = 0.72;

export type ComposerHoverPhase = "enter" | "exit";

function speedUnit(speedPxPerMs: number): number {
  if (!Number.isFinite(speedPxPerMs) || speedPxPerMs <= SPEED_SLOW) return 0;
  if (speedPxPerMs >= SPEED_FAST) return 1;
  return (
    (Math.log(speedPxPerMs) - Math.log(SPEED_SLOW)) / (Math.log(SPEED_FAST) - Math.log(SPEED_SLOW))
  );
}

/** Perceptual blend: the middle of the range is where most hands actually move. */
function smoothstep(unit: number): number {
  return unit * unit * (3 - 2 * unit);
}

/**
 * Faster pointer → shorter hover. Logarithmic, not `ref / speed`, so a flick
 * and a crawl stay in one family instead of snapping or stalling.
 * `previousSpeedPxPerMs` is the speed from a few dozen milliseconds earlier:
 * a hand that is slowing down (landing) holds a little longer, and one that
 * is speeding up (passing through) lets go a little sooner.
 */
export function composerHoverDurationScale(
  speedPxPerMs: number,
  phase: ComposerHoverPhase = "enter",
  previousSpeedPxPerMs = speedPxPerMs,
): number {
  const slow = phase === "exit" ? EXIT_SLOW : ENTER_SLOW;
  const fast = phase === "exit" ? EXIT_FAST : ENTER_FAST;
  let scale = slow + (fast - slow) * smoothstep(speedUnit(speedPxPerMs));

  if (
    Number.isFinite(previousSpeedPxPerMs) &&
    previousSpeedPxPerMs > 0 &&
    Number.isFinite(speedPxPerMs) &&
    speedPxPerMs > 0
  ) {
    const ratio = speedPxPerMs / previousSpeedPxPerMs;
    const nudge = Math.min(0.1, Math.max(-0.08, (1 - ratio) * 0.15));
    scale *= 1 + nudge;
  }

  return Math.min(Math.max(fast, slow) * 1.08, Math.max(Math.min(fast, slow) * 0.92, scale));
}

/** 1 when the hand is still, near 0 when it is flicking. Drives the halo size. */
export function composerHoverSettle(speedPxPerMs: number): number {
  return 1 - smoothstep(speedUnit(speedPxPerMs));
}

export function composerHoverIsTraveling(speedPxPerMs: number): boolean {
  return Number.isFinite(speedPxPerMs) && speedPxPerMs >= COMPOSER_HOVER_TRAVEL_SPEED;
}

export function smoothPointerSpeed(previous: number, sample: number, dtMs: number): number {
  if (!Number.isFinite(sample) || sample < 0) return previous > 0 ? previous : 0;
  if (!(previous > 0) || !(dtMs > 0)) return sample;
  const alpha = 1 - Math.exp(-dtMs / COMPOSER_HOVER_SPEED_TAU_MS);
  return previous + (sample - previous) * alpha;
}

export interface ComposerHoverSample {
  /** Smoothed speed after this sample, px/ms. */
  speed: number;
  /** Smoothed speed from about 36ms earlier, for landing versus a flick. */
  approachSpeed: number;
}

/**
 * Pointer-speed memory for one composer. `sample` is every document move.
 * `crossing` is the shell boundary. `crossing` does not consume the point,
 * so a pointermove on the same event can still sample it.
 */
export function createComposerHoverTracker() {
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let lastSpeed = 0;
  let smoothed = 0;
  let approachSpeed = 0;
  let approachStamp = 0;

  const noteApproach = (now: number) => {
    if (approachStamp === 0 || now - approachStamp >= 36) {
      approachSpeed = smoothed;
      approachStamp = now;
    }
  };

  return {
    sample(x: number, y: number, t: number): ComposerHoverSample {
      if (lastT !== 0) {
        noteApproach(t);
        const instant = pointerSpeedPxPerMs(lastX, lastY, lastT, x, y, t);
        lastSpeed = instant;
        smoothed = smoothPointerSpeed(smoothed, instant, t - lastT);
      }
      lastX = x;
      lastY = y;
      lastT = t;
      return { speed: smoothed, approachSpeed };
    },

    crossing(x: number, y: number, t: number): ComposerHoverSample {
      const instant = composerHoverPointerSpeed(lastX, lastY, lastT, lastSpeed, x, y, t);
      const speed = smoothed > 0 ? smoothed * 0.35 + instant * 0.65 : instant;
      return { speed, approachSpeed };
    },

    /** The pointer went quiet. The next cross should read as a slow hand. */
    rest(): void {
      smoothed = 0;
      lastSpeed = 0;
    },
  };
}

/**
 * Which side of the shell the pointer is on after a boundary event.
 * `pointerout`'s target is the node being left, so the target side is not
 * the destination. Returns null when the event did not cross the shell.
 */
export function composerHoverDestinationInside(
  type: string,
  targetInside: boolean,
  relatedInside: boolean,
): boolean | null {
  if (targetInside === relatedInside) return null;
  return type === "pointerover" ? targetInside : relatedInside;
}

export function pointerSpeedPxPerMs(
  fromX: number,
  fromY: number,
  fromT: number,
  toX: number,
  toY: number,
  toT: number,
): number {
  const dt = toT - fromT;
  if (dt <= 0) return 0;
  return Math.hypot(toX - fromX, toY - fromY) / Math.min(dt, COMPOSER_HOVER_SPEED_STALE_MS);
}

/**
 * Enter/leave speed from the last document sample to this event.
 * A stale gap still uses the crossing displacement (dt capped so idle
 * time does not dilute a flick). Only a missing prior coordinate drops
 * to 0. Capture pointermove may already have written this point; a later
 * boundary event at the same coords keeps `lastSpeed` unless that sample
 * is stale (dwell, then a same-point enter).
 */
export function composerHoverPointerSpeed(
  lastX: number,
  lastY: number,
  lastT: number,
  lastSpeed: number,
  toX: number,
  toY: number,
  toT: number,
): number {
  if (lastT === 0) return 0;
  const dt = toT - lastT;
  if (dt <= 0 || (toX === lastX && toY === lastY)) {
    return dt >= COMPOSER_HOVER_SPEED_STALE_MS ? 0 : lastSpeed;
  }
  return pointerSpeedPxPerMs(lastX, lastY, lastT, toX, toY, toT);
}
