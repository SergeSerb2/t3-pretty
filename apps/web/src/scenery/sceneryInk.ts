/**
 * Dynamic chat ink: picks which of the theme's two variant stacks (dark =
 * white ink, light = black ink) is more legible over the current thread's
 * photo, at the translucency and blur the user selected.
 *
 * Why a whole-variant flip instead of overriding text tokens in place: bare
 * text tokens are shared with plated contexts (tool cards, the composer), so
 * flipping only "text over wallpaper" breaks some plate interior somewhere.
 * The two variants are complete, self-consistent palettes whose contrast is
 * already pinned by sceneryContrast.test.ts at every translucency — applying
 * one wholesale is the only choice that cannot create a new worst case.
 *
 * The photo enters as its Unsplash average color. Blur controls how much
 * that average can be trusted: a heavily blurred photo is close to its
 * average everywhere, a sharp one can locally diverge, so low blur raises
 * the margin required to flip away from the user's base appearance.
 */

import { layerStack } from "./glass";
import { gradientPair, type Rgb } from "./palette";
import { WORLD_SCENERY_THEME } from "./worldSceneryTheme";

export type InkVariant = "light" | "dark";

type Rgb255 = readonly [number, number, number];

function hexToRgb(hex: string): Rgb255 | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || !match[1]) {
    return null;
  }
  const value = match[1];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function blend(top: Rgb255, alpha: number, under: Rgb255): Rgb255 {
  return [
    top[0] * alpha + under[0] * (1 - alpha),
    top[1] * alpha + under[1] * (1 - alpha),
    top[2] * alpha + under[2] * (1 - alpha),
  ];
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: Rgb255): number {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

export function contrastRatio(foreground: Rgb255, background: Rgb255): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const scale = (channel: number): number => Math.min(255, Math.max(0, Math.round(channel * 255)));

function gradientAverage(seed: string): Rgb255 {
  const pair = gradientPair(seed);
  const mid = (channel: keyof Rgb) => scale((pair.top[channel] + pair.bottom[channel]) / 2);
  return [mid("red"), mid("green"), mid("blue")];
}

/** The photo tone the ink decision runs on: Unsplash average, else gradient. */
export function effectivePhotoTone(averageColorHex: string | null, seed: string): Rgb255 {
  return (averageColorHex ? hexToRgb(averageColorHex) : null) ?? gradientAverage(seed);
}

const VARIANT_COLORS = {
  dark: WORLD_SCENERY_THEME.colors,
  light: WORLD_SCENERY_THEME.variants!.light!,
} as const;

/**
 * Contrast of a variant's primary text against the backdrop its own stack
 * composites for this photo tone: wash over (photo over canvas).
 */
export function variantScore(variant: InkVariant, tone: Rgb255, translucency: number): number {
  const colors = VARIANT_COLORS[variant];
  const stack = layerStack(translucency, variant);
  const canvas = hexToRgb(colors.canvas)!;
  const wash: Rgb255 = variant === "dark" ? [0, 0, 0] : [255, 255, 255];
  const backdrop = blend(wash, stack.washAlpha, blend(tone, stack.photoOpacity, canvas));
  return contrastRatio(hexToRgb(colors.text)!, backdrop);
}

/**
 * Margin the other variant must beat the base appearance by before auto
 * flips. Blur 100 trusts the average fully (flip on any win); blur 0 demands
 * a 25% better score, since a sharp photo diverges from its average locally.
 */
export function flipMargin(blur: number): number {
  const trust = Math.min(Math.max(blur / 100, 0), 1);
  return 1 + (1 - trust) * 0.25;
}

export interface InkDecisionInput {
  readonly averageColorHex: string | null;
  /** Gradient seed used when no photo average is available. */
  readonly seed: string;
  readonly translucency: number;
  readonly blur: number;
  /** The appearance upstream would apply without the override. */
  readonly baseAppearance: InkVariant;
  readonly inkMode: "auto" | "light" | "dark" | "off";
}

/**
 * Which variant stack to apply. Note the ink→variant inversion: white ink
 * rides the dark variant and vice versa.
 */
export function pickInkVariant(input: InkDecisionInput): InkVariant {
  switch (input.inkMode) {
    case "light":
      return "dark";
    case "dark":
      return "light";
    case "off":
      return input.baseAppearance;
    case "auto":
      break;
  }
  const tone = effectivePhotoTone(input.averageColorHex, input.seed);
  const base = input.baseAppearance;
  const other: InkVariant = base === "dark" ? "light" : "dark";
  const baseScore = variantScore(base, tone, input.translucency);
  const otherScore = variantScore(other, tone, input.translucency);
  return otherScore > baseScore * flipMargin(input.blur) ? other : base;
}
