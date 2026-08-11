/**
 * Best-effort intrinsic image size sniffing for canvas image placement.
 *
 * Reads only container headers (PNG, GIF, JPEG, WebP) — it never decodes
 * pixel data — so unknown or malformed inputs simply return null and the
 * caller falls back to a default placement size.
 */

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

const dimensions = (width: number, height: number): ImageDimensions | null =>
  Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;

function parseJpegDimensions(bytes: Uint8Array, view: DataView): ImageDimensions | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Padding between segments and standalone markers carry no length word.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    // Start-of-frame markers (SOF0-SOF15 minus DHT/JPG/DAC) carry the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return dimensions(view.getUint16(offset + 7), view.getUint16(offset + 5));
    }
    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function parseWebpDimensions(bytes: Uint8Array, view: DataView): ImageDimensions | null {
  const chunk = view.getUint32(12);
  if (chunk === 0x56503820 /* "VP8 " */) {
    return dimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
  if (chunk === 0x5650384c /* "VP8L" */) {
    const b0 = bytes[21]!;
    const b1 = bytes[22]!;
    const b2 = bytes[23]!;
    const b3 = bytes[24]!;
    return dimensions(
      1 + (((b1 & 0x3f) << 8) | b0),
      1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    );
  }
  if (chunk === 0x56503858 /* "VP8X" */) {
    return dimensions(
      1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
      1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)),
    );
  }
  return null;
}

export function parseImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: 8-byte signature, then the IHDR chunk with big-endian dimensions.
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    return dimensions(view.getUint32(16), view.getUint32(20));
  }
  // GIF87a / GIF89a: little-endian logical screen size after "GIF".
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return dimensions(view.getUint16(6, true), view.getUint16(8, true));
  }
  // JPEG: scan the marker segments for a start-of-frame header.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return parseJpegDimensions(bytes, view);
  }
  // WebP: RIFF container with a VP8 / VP8L / VP8X payload chunk.
  if (bytes.length >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    return parseWebpDimensions(bytes, view);
  }
  return null;
}
