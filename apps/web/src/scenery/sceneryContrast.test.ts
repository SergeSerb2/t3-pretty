/**
 * Executable spec for the World Scenery contrast contract, ported from
 * SurgeCode v0.2.7 `scenery-contrast.test.ts`.
 *
 * Chat text has no opaque backdrop: it renders on an arbitrary Unsplash photo
 * with only the legibility wash between them. A photo pixel can be anything,
 * so the only backdrop a color can be checked against is the *worst case*:
 * the wash composited over a pure-black and a pure-white photo (at the photo
 * opacity the glass math produces) over the theme canvas. Whatever survives
 * both survives every photo.
 *
 * Two layers exist on top of the wallpaper:
 *   - bare — prose, links, timestamps. Backdrop is the wash alone.
 *   - plate — user bubbles and code blocks. These stack a second translucent
 *     fill under themselves, which bounds their backdrop far more tightly.
 *
 * A plate is a flat translucent fill rather than a glass/blur material on
 * purpose: a material samples whatever is behind it, so it cannot promise a
 * contrast floor. A fixed alpha can. Do not soften a token or a plate alpha
 * without rerunning this test.
 */
import { describe, expect, it } from "vite-plus/test";

import { clampTranslucency, coverage, layerStack } from "./glass";
import { stableIndex } from "./palette";
import { WORLD_SCENERY_THEME } from "./worldSceneryTheme";

type Rgb = readonly [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function blend(top: Rgb, alpha: number, under: Rgb): Rgb {
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

function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The two worst backdrops a wash + photo stack can produce over the canvas. */
function worstBackdrops(
  canvasHex: string,
  appearance: "light" | "dark",
  translucency: number,
): Rgb[] {
  const stack = layerStack(translucency, appearance);
  const canvas = hexToRgb(canvasHex);
  const wash = appearance === "dark" ? BLACK : WHITE;
  return [BLACK, WHITE].map((extreme) =>
    blend(wash, stack.washAlpha, blend(extreme, stack.photoOpacity, canvas)),
  );
}

function worstContrast(foregroundHex: string, backdrops: ReadonlyArray<Rgb>): number {
  return Math.min(...backdrops.map((backdrop) => contrastRatio(hexToRgb(foregroundHex), backdrop)));
}

/** Mirror of the plate fills declared in scenery.css. */
const PLATES = {
  dark: {
    message: { color: [20, 38, 27] as Rgb, alpha: 0.85 },
    code: { color: [0, 0, 0] as Rgb, alpha: 0.5 },
  },
  light: {
    message: { color: [223, 239, 227] as Rgb, alpha: 0.85 },
    code: { color: [255, 255, 255] as Rgb, alpha: 0.72 },
  },
} as const;

// The user slider runs 0.5–1.0; the low end is the thinnest wash and
// therefore the worst case for every token.
const TRANSLUCENCIES = [0.5, 0.85, 1];

const APPEARANCES = [
  { appearance: "dark" as const, colors: WORLD_SCENERY_THEME.colors },
  { appearance: "light" as const, colors: WORLD_SCENERY_THEME.variants!.light! },
];

describe("world scenery contrast contract", () => {
  for (const { appearance, colors } of APPEARANCES) {
    for (const translucency of TRANSLUCENCIES) {
      const backdrops = worstBackdrops(colors.canvas, appearance, translucency);
      const label = `${appearance} t=${translucency}`;

      it(`${label}: bare text clears AA (4.5:1)`, () => {
        for (const role of [
          "text",
          "textMuted",
          "errorForeground",
          "warningForeground",
          "updateForeground",
        ] as const) {
          expect
            .soft(worstContrast(colors[role], backdrops), `${role} ${colors[role]}`)
            .toBeGreaterThanOrEqual(4.5);
        }
      });

      it(`${label}: icons and hints clear 3:1`, () => {
        for (const role of [
          "iconMuted",
          "placeholder",
          "secondaryLabel",
          "mutedForeground",
          "accent",
        ] as const) {
          expect
            .soft(worstContrast(colors[role], backdrops), `${role} ${colors[role]}`)
            .toBeGreaterThanOrEqual(3);
        }
      });

      it(`${label}: plate content clears AA on its plate`, () => {
        const plates = PLATES[appearance];
        const messageBackdrops = backdrops.map((backdrop) =>
          blend(plates.message.color, plates.message.alpha, backdrop),
        );
        const codeBackdrops = backdrops.map((backdrop) =>
          blend(plates.code.color, plates.code.alpha, backdrop),
        );
        expect
          .soft(worstContrast(colors.messageForeground, messageBackdrops), "messageForeground")
          .toBeGreaterThanOrEqual(4.5);
        expect
          .soft(worstContrast(colors.codeForeground, codeBackdrops), "codeForeground")
          .toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("glass layering invariant", () => {
  it("photo + wash composite to exactly the translucency", () => {
    for (const t of [0.5, 0.6, 0.7, 0.85, 0.95, 1]) {
      for (const appearance of ["light", "dark"] as const) {
        const stack = layerStack(t, appearance);
        expect(coverage(stack.photoOpacity, stack.washAlpha)).toBeCloseTo(clampTranslucency(t), 10);
      }
    }
  });
});

describe("stableIndex", () => {
  it("matches the Swift FNV-1a bucketing exactly", () => {
    // Golden values computed from the reference 64-bit FNV-1a.
    expect(stableIndex("a", 6)).toBe(4);
    expect(stableIndex("abc", 6)).toBe(3);
    expect(stableIndex("environment-test:thread-1", 377)).toBe(37);
    expect(stableIndex("daily|2026-08-08", 377)).toBe(172);
  });

  it("is stable and in range", () => {
    expect(stableIndex("anything", 0)).toBe(0);
    for (const seed of ["x", "y", "environment:thread"]) {
      const index = stableIndex(seed, 7);
      expect(index).toBe(stableIndex(seed, 7));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(7);
    }
  });
});
