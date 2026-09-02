/** Same-point lastSpeed is only the just-sampled step, not a dwell. */
export const COMPOSER_HOVER_SPEED_STALE_MS = 100;

const DUR_MIN = 0.25;
const DUR_MAX = 1.7;
/** px/ms that keeps the CSS base durations (scale = 1). */
const DUR_REF_SPEED = 0.45;

/**
 * Faster pointer → shorter hover in/out. `speedPxPerMs` is the last
 * inter-event velocity (px per ms), not distance from the composer edge.
 */
export function composerHoverDurationScale(speedPxPerMs: number): number {
  if (!Number.isFinite(speedPxPerMs) || speedPxPerMs <= 0) return DUR_MAX;
  return Math.min(DUR_MAX, Math.max(DUR_MIN, DUR_REF_SPEED / speedPxPerMs));
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
