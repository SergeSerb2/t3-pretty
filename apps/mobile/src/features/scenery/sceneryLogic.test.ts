import { describe, expect, it } from "vite-plus/test";

import webSeedPoolJson from "../../../../web/src/scenery/seedPool.json";
import webDeepForestJson from "../../../../web/src/scenery/seeds/deep-forest.json";
import webGrandBuildingsJson from "../../../../web/src/scenery/seeds/grand-buildings.json";
import webNightCitiesJson from "../../../../web/src/scenery/seeds/night-cities.json";
import webNightSkyJson from "../../../../web/src/scenery/seeds/night-sky.json";
import { PHOTO_SET_IDS as WEB_PHOTO_SET_IDS } from "../../../../web/src/scenery/photoSets";
import { PHOTO_SET_IDS, PHOTO_SETS } from "./photoSets";
import mobileSeedPoolJson from "./seedPool.json";
import mobileDeepForestJson from "./seeds/deep-forest.json";
import mobileGrandBuildingsJson from "./seeds/grand-buildings.json";
import mobileNightCitiesJson from "./seeds/night-cities.json";
import mobileNightSkyJson from "./seeds/night-sky.json";
import {
  capAssignments,
  chatWashBase,
  clampBlur,
  clampTranslucency,
  coverage,
  dailyFeatured,
  dailySeed,
  DEFAULT_BLUR,
  DEFAULT_TRANSLUCENCY,
  dolomitesGradientPairs,
  fallbackPhoto,
  getSceneryPool,
  gradientPair,
  layerStack,
  loadSeedPhotos,
  peekSeedPhotos,
  photoOpacity,
  photosFromSeedModule,
  pickScenery,
  sceneryPoolForSet,
  SCENERY_POOL,
  sizedImageURL,
  stableIndex,
  wallpaperPixelWidth,
  wallpaperURL,
  washAlpha,
  type SceneryPhoto,
} from "./sceneryLogic";

function makePhoto(id: string, overrides: Partial<SceneryPhoto> = {}): SceneryPhoto {
  return {
    id,
    name: `Location ${id}`,
    averageColorHex: "#808080",
    heroURL: `https://images.unsplash.com/${id}?w=1080`,
    thumbURL: `https://images.unsplash.com/${id}?w=200`,
    rawURL: null,
    downloadLocationURL: null,
    photographerName: "Photographer",
    photographerProfileURL: null,
    ...overrides,
  };
}

describe("stableIndex", () => {
  // Golden values shared with the desktop theme (sceneryContrast.test.ts) —
  // the same thread key must bucket identically on every surface.
  it("matches the desktop FNV-1a buckets", () => {
    expect(stableIndex("a", 6)).toBe(4);
    expect(stableIndex("abc", 6)).toBe(3);
    expect(stableIndex("environment-test:thread-1", 377)).toBe(37);
    expect(stableIndex("daily|2026-08-08", 377)).toBe(172);
  });

  it("is deterministic and in range", () => {
    for (const seed of ["x", "environment-1:thread-9", "daily|2026-01-01"]) {
      const index = stableIndex(seed, 7);
      expect(index).toBe(stableIndex(seed, 7));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(7);
    }
  });

  it("returns 0 for an empty pool", () => {
    expect(stableIndex("anything", 0)).toBe(0);
  });
});

describe("gradientPair", () => {
  it("is deterministic per seed and drawn from the Dolomites pairs", () => {
    const pair = gradientPair("environment-test:thread-1");
    expect(pair).toBe(gradientPair("environment-test:thread-1"));
    expect(dolomitesGradientPairs).toContainEqual(pair);
    expect(gradientPair("a")).toEqual({
      top: { red: 0.82, green: 0.81, blue: 0.78 },
      bottom: { red: 0.52, green: 0.54, blue: 0.55 },
    });
  });
});

describe("clampBlur / clampTranslucency", () => {
  it("clamps to the documented ranges", () => {
    expect(clampBlur(-5)).toBe(0);
    expect(clampBlur(105)).toBe(100);
    expect(clampBlur(Number.NaN)).toBe(DEFAULT_BLUR);
    expect(clampBlur(52.4)).toBe(52);
    expect(clampTranslucency(0.1)).toBe(0.5);
    expect(clampTranslucency(1.4)).toBe(1);
    expect(clampTranslucency(Number.NaN)).toBe(DEFAULT_TRANSLUCENCY);
  });
});

describe("layerStack", () => {
  it("composites photo + wash to exactly the translucency", () => {
    for (const t of [0.5, 0.85, 1]) {
      for (const scheme of ["light", "dark"] as const) {
        const stack = layerStack(t, scheme);
        expect(stack.coverage).toBeCloseTo(t, 10);
        expect(coverage(stack.photoOpacity, stack.washAlpha)).toBeCloseTo(t, 10);
      }
    }
  });

  it("scales the wash with translucency from the scheme base", () => {
    expect(layerStack(0.85, "dark").washAlpha).toBeCloseTo(washAlpha(chatWashBase("dark"), 0.85));
    expect(layerStack(0.85, "light").washAlpha).toBeCloseTo(washAlpha(chatWashBase("light"), 0.85));
    expect(photoOpacity(1, 1)).toBe(0);
  });
});

describe("pickScenery", () => {
  const pool = Array.from({ length: 80 }, (_, index) => makePhoto(`photo-${index}`));

  it("returns null for an empty pool", () => {
    expect(pickScenery([], {})).toBeNull();
  });

  it("avoids photos assigned within the recent window", () => {
    // Window is min(120, floor(80/2)) = 40.
    const assignments = Object.fromEntries(
      pool
        .slice(0, 40)
        .map((photo, index) => [
          `thread-${index}`,
          { photoId: photo.id, name: photo.name, assignedAt: index + 1 },
        ]),
    );
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const pick = pickScenery(pool, assignments);
      expect(pick).not.toBeNull();
      expect(Number(pick!.id.replace("photo-", ""))).toBeGreaterThanOrEqual(40);
    }
  });

  it("keeps candidates in extra-sized pools instead of excluding the whole set", () => {
    const extraPool = Array.from({ length: 110 }, (_, index) => makePhoto(`extra-${index}`));
    const assignments = Object.fromEntries(
      extraPool.map((photo, index) => [
        `thread-${index}`,
        { photoId: photo.id, name: photo.name, assignedAt: index + 1 },
      ]),
    );
    // Window is min(120, floor(110/2)) = 55, so the oldest 55 stay available.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const pick = pickScenery(extraPool, assignments);
      expect(pick).not.toBeNull();
      expect(Number(pick!.id.replace("extra-", ""))).toBeLessThan(55);
    }
  });

  it("falls back to the whole pool when every photo is recent", () => {
    const tinyPool = pool.slice(0, 3);
    const assignments = Object.fromEntries(
      tinyPool.map((photo, index) => [
        `thread-${index}`,
        { photoId: photo.id, name: photo.name, assignedAt: index + 1 },
      ]),
    );
    expect(tinyPool).toContainEqual(pickScenery(tinyPool, assignments));
  });
});

describe("fallbackPhoto", () => {
  it("is deterministic per thread key and null for an empty pool", () => {
    expect(fallbackPhoto([], "k")).toBeNull();
    const pool = [makePhoto("a"), makePhoto("b"), makePhoto("c")];
    const first = fallbackPhoto(pool, "environment-1:thread-1");
    expect(first).toBe(fallbackPhoto(pool, "environment-1:thread-1"));
    expect(pool).toContainEqual(first);
  });
});

describe("capAssignments", () => {
  it("keeps the 300 newest assignments", () => {
    const assignments = Object.fromEntries(
      Array.from({ length: 305 }, (_, index) => [
        `thread-${index}`,
        { photoId: `photo-${index}`, name: "n", assignedAt: index },
      ]),
    );
    const capped = capAssignments(assignments);
    expect(Object.keys(capped)).toHaveLength(300);
    expect(capped["thread-304"]).toBeDefined();
    expect(capped["thread-0"]).toBeUndefined();
    expect(capAssignments({})).toEqual({});
  });
});

describe("dailyFeatured", () => {
  it("is deterministic per day and rotates across days", () => {
    const seed = dailySeed(new Date(2026, 7, 8));
    expect(seed).toBe("daily|2026-08-08");
    const today = dailyFeatured(SCENERY_POOL, seed);
    expect(today).toBe(dailyFeatured(SCENERY_POOL, seed));
    expect(today).not.toBeNull();
    const others = new Set(
      Array.from(
        { length: 14 },
        (_, day) => dailyFeatured(SCENERY_POOL, dailySeed(new Date(2026, 7, day + 1)))?.id,
      ),
    );
    // Not every day needs a distinct photo, but a fortnight must rotate.
    expect(others.size).toBeGreaterThan(4);
  });
});

describe("sizedImageURL", () => {
  // Outputs generated from the web implementation (apps/web/src/scenery/
  // unsplash.ts) — the manual query rewrite must stay byte-identical.
  const rawSantorini =
    "https://images.unsplash.com/photo-1563789031959-4c02bcb41319?ixid=M3w5NjU0NTR8MHwxfHNlYXJjaHwxfHxzYW50b3JpbmklMjBncmVlY2UlMjBjYWxkZXJhfGVufDF8MHx8fDE3ODQ5NTE1Mjd8MA&ixlib=rb-4.1.0";
  const heroSantorini =
    "https://images.unsplash.com/photo-1563789031959-4c02bcb41319?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w5NjU0NTR8MHwxfHNlYXJjaHwxfHxzYW50b3JpbmklMjBncmVlY2UlMjBjYWxkZXJhfGVufDF8MHx8fDE3ODQ5NTE1Mjd8MA&ixlib=rb-4.1.0&q=80&w=1080";

  it("rewrites sizing params while keeping identity params", () => {
    expect(sizedImageURL(rawSantorini, { width: 1290, blur: 50, saturation: 5 })).toBe(
      `${rawSantorini}&w=1290&q=85&fm=jpg&fit=max&blur=50&sat=5`,
    );
  });

  it("drops the blur param at 0", () => {
    expect(sizedImageURL(rawSantorini, { width: 750, saturation: 5 })).toBe(
      `${rawSantorini}&w=750&q=85&fm=jpg&fit=max&sat=5`,
    );
  });

  it("strips stale sizing params from a pre-sized URL", () => {
    expect(sizedImageURL(heroSantorini, { width: 256, blur: 50, saturation: 5 })).toBe(
      "https://images.unsplash.com/photo-1563789031959-4c02bcb41319?cs=tinysrgb&ixid=M3w5NjU0NTR8MHwxfHNlYXJjaHwxfHxzYW50b3JpbmklMjBncmVlY2UlMjBjYWxkZXJhfGVufDF8MHx8fDE3ODQ5NTE1Mjd8MA&ixlib=rb-4.1.0&w=256&q=85&fm=jpg&fit=max&blur=50&sat=5",
    );
  });

  it("returns URLs without a query string untouched", () => {
    expect(sizedImageURL("https://example.com/photo", { width: 256 })).toBe(
      "https://example.com/photo",
    );
  });
});

describe("wallpaperURL / wallpaperPixelWidth", () => {
  it("prefers the raw URL and sizes in 256px steps capped at 3840", () => {
    expect(wallpaperPixelWidth(1170)).toBe(1280);
    expect(wallpaperPixelWidth(1290)).toBe(1536);
    expect(wallpaperPixelWidth(99999)).toBe(3840);
    const photo = makePhoto("x", {
      rawURL: "https://images.unsplash.com/photo-x?ixid=abc",
      heroURL: "https://images.unsplash.com/photo-x?fit=max&w=1080",
    });
    expect(wallpaperURL(photo, 50, 1280)).toBe(
      "https://images.unsplash.com/photo-x?ixid=abc&w=1280&q=85&fm=jpg&fit=max&blur=50&sat=5",
    );
    expect(wallpaperURL({ ...photo, rawURL: null }, 0, 1280)).toBe(
      "https://images.unsplash.com/photo-x?w=1280&q=85&fm=jpg&fit=max&sat=5",
    );
  });
});

describe("seed pool", () => {
  it("is the same file the desktop theme ships", () => {
    expect(mobileSeedPoolJson).toEqual(webSeedPoolJson);
  });

  it("is well-formed and uniquely keyed", () => {
    expect(SCENERY_POOL.length).toBeGreaterThan(300);
    const ids = new Set<string>();
    for (const photo of SCENERY_POOL) {
      expect(photo.id.length).toBeGreaterThan(0);
      expect(photo.name.length).toBeGreaterThan(0);
      expect(photo.heroURL).toContain("images.unsplash.com");
      expect(photo.photographerName.length).toBeGreaterThan(0);
      expect(ids.has(photo.id)).toBe(false);
      ids.add(photo.id);
    }
  });

  it("merges fetched photos over the seed pool", () => {
    const extra = makePhoto("fetched-1");
    const pool = getSceneryPool([extra]);
    expect(pool).toContainEqual(extra);
    expect(pool.length).toBe(SCENERY_POOL.length + 1);
  });

  it("ships the same extra photo sets as desktop", async () => {
    expect(PHOTO_SET_IDS).toEqual(WEB_PHOTO_SET_IDS);
    expect(PHOTO_SETS.map((set) => set.id)).toEqual(PHOTO_SET_IDS);
    expect(mobileNightCitiesJson).toEqual(webNightCitiesJson);
    expect(mobileDeepForestJson).toEqual(webDeepForestJson);
    expect(mobileNightSkyJson).toEqual(webNightSkyJson);
    expect(mobileGrandBuildingsJson).toEqual(webGrandBuildingsJson);
    expect(peekSeedPhotos("world-scenery").length).toBeGreaterThan(800);
    const cities = await loadSeedPhotos("night-cities");
    expect(cities.length).toBeGreaterThan(100);
    const forest = await loadSeedPhotos("deep-forest");
    expect(sceneryPoolForSet("deep-forest").length).toBe(forest.length);
  });

  it("reads JSON seed modules in Metro, Vite, and array shapes", () => {
    const photos = [makePhoto("a")];
    expect(photosFromSeedModule({ photos })).toEqual(photos);
    expect(photosFromSeedModule({ default: { photos } })).toEqual(photos);
    expect(photosFromSeedModule(photos)).toEqual(photos);
    expect(photosFromSeedModule({ default: photos })).toEqual(photos);
    expect(photosFromSeedModule({})).toEqual([]);
    expect(photosFromSeedModule(null)).toEqual([]);
  });
});
