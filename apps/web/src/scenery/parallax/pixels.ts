import type { PixelBuffer } from "./types";

export function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

export function createPixelBuffer(
  width: number,
  height: number,
  data?: Uint8ClampedArray,
): PixelBuffer {
  const size = width * height * 4;
  return {
    width,
    height,
    data: data ?? new Uint8ClampedArray(size),
  };
}

export function copyRgba(source: Uint8ClampedArray): Uint8ClampedArray {
  return new Uint8ClampedArray(source);
}

export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function pixelCount(buffer: PixelBuffer): number {
  return buffer.width * buffer.height;
}
