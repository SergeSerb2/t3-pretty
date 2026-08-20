/**
 * Fast morphological fill for pixels hidden behind a closer layer.
 *
 * A generative fill (FLUX.1 Fill) would hallucinate more of the scene at
 * large camera moves. This dilate-and-average is enough for the small look
 * we actually apply, and it stays on-device with no extra model.
 */

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

export function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) {
    return new Uint8Array(mask);
  }
  let current = new Uint8Array(mask);
  let next = new Uint8Array(mask.length);
  for (let pass = 0; pass < radius; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (current[i]) {
          next[i] = 1;
          continue;
        }
        let on = 0;
        for (const [dx, dy] of NEIGHBORS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          if (current[ny * width + nx]) {
            on = 1;
            break;
          }
        }
        next[i] = on;
      }
    }
    const swap = current;
    current = next;
    next = swap;
  }
  return current;
}

/**
 * Fill `hole` pixels by repeatedly copying the average of known neighbors.
 * Mutates a copy; the source RGBA is left intact.
 */
export function inpaintHoles(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  hole: Uint8Array,
  passes = 14,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  const known = new Uint8Array(width * height);
  for (let i = 0; i < known.length; i++) {
    known[i] = hole[i] ? 0 : 1;
  }

  for (let pass = 0; pass < passes; pass++) {
    let changed = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (known[i]) {
          continue;
        }
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const [dx, dy] of NEIGHBORS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          const ni = ny * width + nx;
          if (!known[ni]) {
            continue;
          }
          const o = ni * 4;
          r += out[o]!;
          g += out[o + 1]!;
          b += out[o + 2]!;
          n += 1;
        }
        if (n === 0) {
          continue;
        }
        const o = i * 4;
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = 255;
        known[i] = 1;
        changed += 1;
      }
    }
    if (changed === 0) {
      break;
    }
  }

  return out;
}
