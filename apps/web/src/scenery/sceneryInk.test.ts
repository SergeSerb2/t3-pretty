/**
 * Behavior spec for the dynamic ink decision. Legibility of each variant's
 * tokens over its own stack is already pinned by sceneryContrast.test.ts —
 * because auto ink always applies one variant wholesale, that contract
 * covers every state this decision can reach. What is tested here is the
 * decision itself: which variant wins for which photo tone, and how blur
 * gates the willingness to flip away from the base appearance.
 */
import { describe, expect, it } from "vite-plus/test";

import { effectivePhotoTone, flipMargin, pickInkVariant, variantScore } from "./sceneryInk";

const BRIGHT_SKY = "#e8e8e8";
const NIGHT_CITY = "#0c0f12";
const MID_GRAY = "#808080";

const base = (overrides: Partial<Parameters<typeof pickInkVariant>[0]>) => ({
  averageColorHex: MID_GRAY,
  seed: "test-thread",
  translucency: 0.85,
  blur: 50,
  baseAppearance: "dark" as const,
  inkMode: "auto" as const,
  ...overrides,
});

describe("pickInkVariant", () => {
  it("manual modes are absolute: light ink = dark stack, dark ink = light stack", () => {
    expect(pickInkVariant(base({ inkMode: "light", averageColorHex: BRIGHT_SKY }))).toBe("dark");
    expect(pickInkVariant(base({ inkMode: "dark", averageColorHex: NIGHT_CITY }))).toBe("light");
  });

  it("off follows the base appearance regardless of the photo", () => {
    expect(pickInkVariant(base({ inkMode: "off", averageColorHex: BRIGHT_SKY }))).toBe("dark");
    expect(
      pickInkVariant(
        base({ inkMode: "off", averageColorHex: BRIGHT_SKY, baseAppearance: "light" }),
      ),
    ).toBe("light");
  });

  it("auto flips a dark-mode thread to black ink over a bright photo", () => {
    expect(pickInkVariant(base({ averageColorHex: BRIGHT_SKY }))).toBe("light");
  });

  it("auto flips a light-mode thread to white ink over a night photo", () => {
    expect(pickInkVariant(base({ averageColorHex: NIGHT_CITY, baseAppearance: "light" }))).toBe(
      "dark",
    );
  });

  it("auto keeps the base appearance for ambiguous mid tones (hysteresis)", () => {
    expect(pickInkVariant(base({ averageColorHex: MID_GRAY }))).toBe("dark");
    expect(pickInkVariant(base({ averageColorHex: MID_GRAY, baseAppearance: "light" }))).toBe(
      "light",
    );
  });

  it("auto survives a missing average color via the gradient fallback", () => {
    for (const appearance of ["light", "dark"] as const) {
      const variant = pickInkVariant(base({ averageColorHex: null, baseAppearance: appearance }));
      expect(["light", "dark"]).toContain(variant);
    }
  });
});

describe("flipMargin", () => {
  it("demands more advantage the sharper the photo", () => {
    expect(flipMargin(100)).toBe(1);
    expect(flipMargin(0)).toBeCloseTo(1.25, 10);
    expect(flipMargin(0)).toBeGreaterThan(flipMargin(50));
    expect(flipMargin(50)).toBeGreaterThan(flipMargin(100));
  });
});

describe("variantScore", () => {
  it("each variant is safely legible over its own worst-fit photo tone", () => {
    // Even when a variant loses the pick, the picked one must clear AA for
    // primary text — the average tone is by definition within [black, white],
    // and sceneryContrast pins those extremes; spot-check the averages here.
    for (const tone of [BRIGHT_SKY, NIGHT_CITY, MID_GRAY]) {
      const parsed = effectivePhotoTone(tone, "seed");
      for (const t of [0.5, 0.85, 1]) {
        const best = Math.max(variantScore("dark", parsed, t), variantScore("light", parsed, t));
        expect(best).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("effectivePhotoTone", () => {
  it("parses Unsplash average hexes with or without the hash", () => {
    expect(effectivePhotoTone("#336699", "s")).toEqual([51, 102, 153]);
    expect(effectivePhotoTone("336699", "s")).toEqual([51, 102, 153]);
  });

  it("falls back to the deterministic gradient tone", () => {
    const first = effectivePhotoTone(null, "thread-a");
    expect(first).toEqual(effectivePhotoTone(null, "thread-a"));
    expect(first).toEqual(effectivePhotoTone("not-a-color", "thread-a"));
  });
});
