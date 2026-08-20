/**
 * Virtual-camera look for the LDI rig. Pointer position is the target;
 * the pose eases toward it so the photo has weight instead of snapping.
 * The animation frame stops once the pose has settled.
 */

export interface PointerLook {
  readonly x: number;
  readonly y: number;
}

const SETTLE_EPSILON = 0.0008;
/** Time constant in ms — ~140ms feels like a heavy postcard, not a cursor. */
const LOOK_TAU_MS = 140;

export function clampLook(value: number): number {
  if (value <= -1) {
    return -1;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

export function lookFromPointer(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
): PointerLook {
  const safeWidth = width > 0 ? width : 1;
  const safeHeight = height > 0 ? height : 1;
  return {
    x: clampLook((clientX / safeWidth) * 2 - 1),
    y: clampLook((clientY / safeHeight) * 2 - 1),
  };
}

export function lookDistance(from: PointerLook, to: PointerLook): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.hypot(dx, dy);
}

export function stepPointerLook(
  current: PointerLook,
  target: PointerLook,
  dtMs: number,
  tauMs = LOOK_TAU_MS,
): PointerLook {
  const dt = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0;
  const tau = tauMs > 0 ? tauMs : LOOK_TAU_MS;
  const mix = 1 - Math.exp(-dt / tau);
  return {
    x: current.x + (target.x - current.x) * mix,
    y: current.y + (target.y - current.y) * mix,
  };
}

export function lookHasSettled(current: PointerLook, target: PointerLook): boolean {
  return lookDistance(current, target) < SETTLE_EPSILON;
}

export function rigTransform(look: PointerLook): string {
  const tiltX = (-look.y * 6.5).toFixed(3);
  const tiltY = (look.x * 8.5).toFixed(3);
  return `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
}

export function layerTransform(z: number): string {
  const depth = (0.5 - z) * 78;
  return `translateZ(${depth.toFixed(2)}px)`;
}
