/** Ignore a parked pointer; only the last moving sample should set hover time. */
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
  if (dt <= 0 || dt >= COMPOSER_HOVER_SPEED_STALE_MS) return 0;
  return Math.hypot(toX - fromX, toY - fromY) / dt;
}
