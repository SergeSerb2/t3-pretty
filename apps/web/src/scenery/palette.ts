/**
 * The non-photo half of the World scenery look: deterministic duotone
 * gradient washes used wherever a photo has not loaded yet (or the Unsplash
 * key is absent), so the theme degrades to the same palette instead of gray
 * placeholders. Port of SurgeCode v0.2.7 `AlpineTheme.swift` — every constant
 * is the same number, and `stableIndex` is the same FNV-1a hash, so a thread
 * seeded here and the same thread seeded in SurgeCode pick the same gradient.
 */

export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface GradientPair {
  readonly top: Rgb;
  readonly bottom: Rgb;
}

export function rgb(red: number, green: number, blue: number): Rgb {
  return { red, green, blue };
}

const clampChannel = (value: number): number => Math.min(255, Math.max(0, Math.round(value * 255)));

/** CSS color for an `Rgb`, optionally with alpha. */
export function cssColor(color: Rgb, alpha = 1): string {
  const channels = [color.red, color.green, color.blue].map(clampChannel).join(" ");
  return alpha >= 1 ? `rgb(${channels})` : `rgb(${channels} / ${alpha})`;
}

/**
 * Duotone washes sampled from Dolomites conditions: dawn limestone, glacier
 * melt, high meadow, larch dusk, scree, spruce shade.
 */
export const dolomitesGradientPairs: ReadonlyArray<GradientPair> = [
  { top: rgb(0.93, 0.8, 0.71), bottom: rgb(0.56, 0.55, 0.62) },
  { top: rgb(0.73, 0.85, 0.87), bottom: rgb(0.42, 0.56, 0.64) },
  { top: rgb(0.72, 0.8, 0.58), bottom: rgb(0.36, 0.5, 0.4) },
  { top: rgb(0.89, 0.72, 0.51), bottom: rgb(0.47, 0.42, 0.5) },
  { top: rgb(0.82, 0.81, 0.78), bottom: rgb(0.52, 0.54, 0.55) },
  { top: rgb(0.55, 0.66, 0.56), bottom: rgb(0.25, 0.34, 0.32) },
];

const FNV_OFFSET_BASIS = 0xcbf2_9ce4_8422_2325n;
const FNV_PRIME = 0x0000_0100_0000_01b3n;
const U64_MASK = 0xffff_ffff_ffff_ffffn;

/**
 * FNV-1a over UTF-8, reduced mod `count`. `BigInt` masked to 64 bits matches
 * Swift's `UInt64` wrapping multiply exactly; a `Number`-based port cannot,
 * because the product overflows 2^53 on the first byte. The assignment has to
 * survive a relaunch, so per-launch-seeded hashes are out.
 */
export function stableIndex(seed: string, count: number): number {
  if (count <= 0) {
    return 0;
  }
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(seed)) {
    hash = (hash ^ BigInt(byte)) & U64_MASK;
    hash = (hash * FNV_PRIME) & U64_MASK;
  }
  return Number(hash % BigInt(count));
}

/**
 * Deterministic gradient pair for a seed (thread/photo id): the same entity
 * always falls back to the same wash across launches.
 */
export function gradientPair(seed: string): GradientPair {
  return dolomitesGradientPairs[stableIndex(seed, dolomitesGradientPairs.length)]!;
}

/** `linear-gradient(...)` matching SwiftUI's topLeading → bottomTrailing. */
export function gradientCss(seed: string): string {
  const pair = gradientPair(seed);
  return `linear-gradient(135deg, ${cssColor(pair.top)}, ${cssColor(pair.bottom)})`;
}
