/**
 * How the scenery layers stack under the chat content for a given
 * translucency `t`. Port of SurgeCode's `GlassLayering.swift` (v0.2.7 mac
 * values), adapted for a browser/Electron surface: there is no desktop behind
 * the page, so the "window plate" is simply the opaque theme canvas the app
 * already paints, and only the wash + photo pair is computed here.
 *
 * Bottom to top:
 *  1. **canvas** — the opaque theme background (the plate)
 *  2. **scenery photo** — the location image, pre-blurred on the CDN
 *  3. **legibility wash** — flat tone over the photo so primary text stays
 *     readable on top (long-form text never sits on glass, so the wash is
 *     what carries its contrast)
 *  4. **chrome glass** — left sidebar, right panel, bottom terminal, header, composer
 *
 * The invariant: **photo + wash composite to exactly `t`** over the canvas.
 * The photo gives up whatever alpha the wash takes — `photoOpacity` solves
 * the over-composite for the leftover.
 *
 * The trap this encodes: fading a stack of two layers (the gradient fallback
 * and the photo above it) separately composites them *both*, covering far
 * more than the requested alpha. The scenery group needs `isolation: isolate`
 * and a single `opacity` on the group, never one per child.
 */

export const TRANSLUCENCY_RANGE = { lowerBound: 0.5, upperBound: 1 } as const;
export const DEFAULT_TRANSLUCENCY = 0.85;

export function clampTranslucency(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_TRANSLUCENCY;
  }
  return Math.min(Math.max(value, TRANSLUCENCY_RANGE.lowerBound), TRANSLUCENCY_RANGE.upperBound);
}

/**
 * Flat wash over the chat wallpaper. Dark mode pulls toward black, light mode
 * toward white — enough to keep primary/secondary text legible over a bright
 * sky. These are the current mac values (0.62/0.70); the older Windows port's
 * 0.5/0.58 are stale.
 */
export function chatWashBase(colorScheme: "light" | "dark"): number {
  return colorScheme === "dark" ? 0.62 : 0.7;
}

/** Added to the wash base when the user asks for increased contrast. */
export const CONTRAST_WASH_BOOST = 0.1;

/** Wash at the top/bottom edges of the empty-state hero. */
export const HERO_WASH_BASE_TOP = 0.1;
export const HERO_WASH_BASE_BOTTOM = 0.3;

/** Edge-tint gradient multipliers for the chat wallpaper (top / bottom). */
export const EDGE_WASH_TOP = 0.35;
export const EDGE_WASH_BOTTOM = 0.25;

/**
 * Alpha of a wash layer at translucency `t`. Scaling the wash with `t` is
 * what keeps the photo visible: a wash held near-constant keeps the pane
 * ~86% covered even at the glass end.
 */
export function washAlpha(base: number, translucency: number): number {
  return Math.min(base, 1) * clampTranslucency(translucency);
}

/**
 * Opacity for the photo under a wash of `washAlpha`, such that the two
 * together cover exactly `t`. Solves `wash + photo * (1 - wash) = t`.
 */
export function photoOpacity(translucency: number, wash: number): number {
  const t = clampTranslucency(translucency);
  if (wash >= 1) {
    return 0;
  }
  return Math.min(Math.max((t - wash) / (1 - wash), 0), 1);
}

/** What a photo + wash pair actually covers — `t` by construction. */
export function coverage(photo: number, wash: number): number {
  return wash + photo * (1 - wash);
}

/** The complete layer stack for a translucency, ready to hand to CSS. */
export interface SceneryLayerStack {
  readonly washAlpha: number;
  readonly photoOpacity: number;
  readonly edgeTopAlpha: number;
  readonly edgeBottomAlpha: number;
  /** Always equals the clamped translucency. */
  readonly coverage: number;
}

export function layerStack(
  translucency: number,
  colorScheme: "light" | "dark",
  increasedContrast = false,
): SceneryLayerStack {
  const t = clampTranslucency(translucency);
  const base = chatWashBase(colorScheme) + (increasedContrast ? CONTRAST_WASH_BOOST : 0);
  const wash = washAlpha(base, t);
  const photo = photoOpacity(t, wash);
  return {
    washAlpha: wash,
    photoOpacity: photo,
    edgeTopAlpha: EDGE_WASH_TOP * t,
    edgeBottomAlpha: EDGE_WASH_BOTTOM * t,
    coverage: coverage(photo, wash),
  };
}
