/**
 * Landscape-aware monocular depth for World Scenery photos.
 *
 * A neural estimator (Depth Anything 3 / Depth Pro) can replace this by
 * writing a 0–1 depth field of the same shape. The prior is tuned for the
 * catalog we actually ship: outdoor places with sky on top, ground below,
 * haze in the distance, and darker silhouettes up close.
 */
import { clamp01, luma } from "./pixels";
import type { PixelBuffer } from "./types";

export function estimateLandscapeDepth(image: PixelBuffer): Float32Array {
  const { data, width, height } = image;
  const depth = new Float32Array(width * height);
  const invW = width <= 1 ? 0 : 1 / (width - 1);
  const invH = height <= 1 ? 0 : 1 / (height - 1);

  for (let y = 0; y < height; y++) {
    const yn = y * invH;
    const upper = 1 - yn;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      const r = data[o]! / 255;
      const g = data[o + 1]! / 255;
      const b = data[o + 2]! / 255;
      const lum = luma(r, g, b);
      const maxc = Math.max(r, g, b);
      const minc = Math.min(r, g, b);
      const sat = maxc <= 1e-6 ? 0 : (maxc - minc) / maxc;
      const xn = x * invW;

      const blueSky = b > r + 0.04 && b >= g * 0.92 && b > 0.28;
      const cloud = lum > 0.72 && sat < 0.22;
      const haze = lum > 0.45 && sat < 0.28 && b >= g * 0.9;
      const sky =
        upper *
        (0.22 + (blueSky ? 0.48 : 0) + (cloud ? 0.34 : 0) + (haze ? 0.16 : 0) + upper * 0.2);

      const vegetation = g > r + 0.02 && g > b && yn > 0.28 ? yn : 0;
      const dark = (1 - lum) * yn;
      const edgeSilhouette = lum < 0.28 && yn > 0.4 && (xn < 0.2 || xn > 0.8 || yn > 0.62) ? yn : 0;

      // 0 = near, 1 = far. Keep headroom in the lower third so a dark
      // foreground can still sit in front of the ground after smoothing.
      depth[i] = clamp01(
        0.22 +
          0.5 * upper +
          0.24 * sky -
          0.45 * dark * dark -
          0.08 * vegetation -
          0.12 * edgeSilhouette,
      );
    }
  }

  return smoothDepth(depth, width, height);
}

/**
 * Two separable box passes. Cheap edge-preserving-enough smoothing so a
 * nose or ridge is not sliced into independent depth bands.
 */
export function smoothDepth(depth: Float32Array, width: number, height: number): Float32Array {
  const temp = new Float32Array(depth.length);
  boxPassHorizontal(depth, temp, width, height);
  boxPassVertical(temp, depth, width, height);
  boxPassHorizontal(depth, temp, width, height);
  boxPassVertical(temp, depth, width, height);
  return depth;
}

function boxPassHorizontal(
  source: Float32Array,
  dest: Float32Array,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x < width - 1 ? x + 1 : x;
      dest[row + x] = (source[row + x0]! + source[row + x]! + source[row + x1]!) / 3;
    }
  }
}

function boxPassVertical(
  source: Float32Array,
  dest: Float32Array,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y++) {
    const y0 = y > 0 ? y - 1 : y;
    const y1 = y < height - 1 ? y + 1 : y;
    const row = y * width;
    const row0 = y0 * width;
    const row1 = y1 * width;
    for (let x = 0; x < width; x++) {
      dest[row + x] = (source[row0 + x]! + source[row + x]! + source[row1 + x]!) / 3;
    }
  }
}
