// @ts-nocheck -- vendored from thinking-orbs (MIT, Jakub Antalik); the upstream
// library is not written for this repo's noUncheckedIndexedAccess setting.
// Shared primitives for the dotted 3D thought-orbs. Ported from inkform
// (PlotterLab's HalftoneSphere lineage): honestly 3D — rotated,
// depth-shaded, z-sorted. Depth is carried by dot size and ink weight
// alone. Plain 2D canvas fills only: no ctx.filter, no SVG filters, so
// every mode renders identically in Chrome, Safari and Firefox.

export interface Dot {
  x: number;
  y: number;
  z: number;
  r: number;
  /** Ink value: 0 = darkest ink on paper. Mirrored on dark themes. */
  white: number;
  a?: number;
}

/** A stroked edge between two projected points (the `connecting` web). */
export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Ink value, same convention as `Dot.white`. */
  white: number;
  a?: number;
  w: number;
}

export type Projector = (x: number, y: number, z: number) => [number, number, number];

export function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

export function frac(x: number): number {
  return x - Math.floor(x);
}

/** Value noise on a 2D lattice — smooth, deterministic, cheap. */
export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hashD(xi, yi);
  const b = hashD(xi + 1, yi);
  const c = hashD(xi, yi + 1);
  const d = hashD(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Deterministic hash in [0, 1). */
export function hashD(a: number, b: number): number {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** Stable directions on a unit sphere (Fibonacci lattice). */
export function fibDir(i: number, n: number): [number, number, number] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const rad = Math.sqrt(1 - y * y);
  const a = i * golden;
  return [rad * Math.cos(a), y, rad * Math.sin(a)];
}

/** Shortest signed angular distance, wrapped to (-π, π]. */
export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/**
 * The light renderer sits directly over the chat backdrop, which can be a
 * bright photo in World Scenery. Pale, translucent far-side dots compound
 * with that backdrop and disappear at the 20px working-row size. Keep the
 * dark renderer's original grayscale ramp, but make light-mode ink denser:
 * its darkest-to-lightest range stays below #242424 and every painted mark
 * carries enough opacity to clear the scenery contrast floor.
 */
const LIGHT_INK_MAX_CHANNEL = 36;
const LIGHT_INK_MIN_ALPHA = 0.6;
const INK_ALPHA_STEPS = 100;
const INK_STYLE_STRIDE = INK_ALPHA_STEPS + 1;
/** Shipped 20/64 orbs stamp ~1 CSS-px marks; squares match circles at that size. */
const CHEAP_DOT_RADIUS = 1.5;
const TAU = Math.PI * 2;

const inkStyleCache: string[] = [];

function inkChannel(white: number, dark: boolean): number {
  const w = Math.min(1, Math.max(0, white));
  return Math.round(dark ? (1 - w) * 255 : w * LIGHT_INK_MAX_CHANNEL);
}

function inkAlpha(alpha: number, dark: boolean): number {
  const painted = dark ? alpha : Math.max(LIGHT_INK_MIN_ALPHA, alpha);
  return Math.round(painted * INK_ALPHA_STEPS) / INK_ALPHA_STEPS;
}

function inkStyle(g: number, a: number): string {
  const ai = Math.round(a * INK_ALPHA_STEPS);
  const key = g * INK_STYLE_STRIDE + ai;
  const hit = inkStyleCache[key];
  if (hit !== undefined) return hit;
  const style = `rgba(${g},${g},${g},${ai / INK_ALPHA_STEPS})`;
  inkStyleCache[key] = style;
  return style;
}

/** Shared spin + tilt + orthographic projection. */
export function makeProj(
  yaw: number,
  tilt: number,
  cx: number,
  cy: number,
  scale: number,
): Projector {
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  const sy = Math.sin(yaw);
  const cyw = Math.cos(yaw);
  return (x, y, z) => {
    const x1 = x * cyw + z * sy;
    const z1 = -x * sy + z * cyw;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}

/**
 * Painter: z-sort far→near, matte grayscale dots. On dark substrates the
 * ink value is mirrored (1 - white) so near dots read bright — the same
 * depth language on an inverted substrate.
 *
 * Small marks use fillRect instead of arc(); at the shipped 20/64 sizes a
 * mark is ~1 CSS pixel, so the square is indistinguishable and skips the
 * antialiased-circle rasterizer that was dominating renderer CPU.
 */
export function paint(ctx: CanvasRenderingContext2D, dots: Dot[], dark: boolean, rMin = 0.3): void {
  dots.sort((a, b) => a.z - b.z);
  let lastStyle = "";
  for (const d of dots) {
    const alpha = d.a ?? 1;
    if (alpha < 0.02) continue;
    const g = inkChannel(d.white, dark);
    const a = inkAlpha(alpha, dark);
    const style = inkStyle(g, a);
    if (style !== lastStyle) {
      ctx.fillStyle = style;
      lastStyle = style;
    }
    const r = Math.max(rMin, d.r);
    if (r <= CHEAP_DOT_RADIUS) {
      ctx.fillRect(d.x - r, d.y - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(d.x, d.y, r, 0, TAU);
      ctx.fill();
    }
  }
}

/** Stroke pass for edge-based modes. Runs before `paint` so nodes sit on top. */
export function paintLines(ctx: CanvasRenderingContext2D, lines: Line[], dark: boolean): void {
  let lastStyle = "";
  let lastWidth = NaN;
  for (const l of lines) {
    const alpha = l.a ?? 1;
    if (alpha < 0.02) continue;
    const g = inkChannel(l.white, dark);
    const a = inkAlpha(alpha, dark);
    const style = inkStyle(g, a);
    if (style !== lastStyle) {
      ctx.strokeStyle = style;
      lastStyle = style;
    }
    if (l.w !== lastWidth) {
      ctx.lineWidth = l.w;
      lastWidth = l.w;
    }
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
}

const dotStorage: Dot[] = [];
const dots: Dot[] = [];
const lineStorage: Line[] = [];
const lines: Line[] = [];

/** Clear the recycled dot list. Call once at the start of a mode's frame. */
export function beginDots(): void {
  dots.length = 0;
}

export function addDot(
  x: number,
  y: number,
  z: number,
  r: number,
  white: number,
  a?: number,
): void {
  const i = dots.length;
  const existing = dotStorage[i];
  if (existing) {
    existing.x = x;
    existing.y = y;
    existing.z = z;
    existing.r = r;
    existing.white = white;
    existing.a = a;
    dots.push(existing);
    return;
  }
  const created: Dot = { x, y, z, r, white, a };
  dotStorage[i] = created;
  dots.push(created);
}

export function paintDots(ctx: CanvasRenderingContext2D, dark: boolean, rMin?: number): void {
  paint(ctx, dots, dark, rMin);
}

export function beginLines(): void {
  lines.length = 0;
}

export function addLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  white: number,
  w: number,
  a?: number,
): void {
  const i = lines.length;
  const existing = lineStorage[i];
  if (existing) {
    existing.x1 = x1;
    existing.y1 = y1;
    existing.x2 = x2;
    existing.y2 = y2;
    existing.white = white;
    existing.w = w;
    existing.a = a;
    lines.push(existing);
    return;
  }
  const created: Line = { x1, y1, x2, y2, white, w, a };
  lineStorage[i] = created;
  lines.push(created);
}

export function paintCollectedLines(ctx: CanvasRenderingContext2D, dark: boolean): void {
  paintLines(ctx, lines, dark);
}

/**
 * Dot radii were tuned for a 300pt frame; sub-linear scaling keeps small
 * spinners legible. Lower pow = radii shrink less with size.
 */
export function radiusScale(size: number, pow: number): number {
  return (size / 300) ** pow;
}
