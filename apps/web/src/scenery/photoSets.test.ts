import { describe, expect, it } from "vite-plus/test";

import { PHOTO_SET_CATALOGS } from "./catalog";
import {
  DEFAULT_PHOTO_SET_ID,
  isPhotoSetId,
  parsePhotoSetId,
  PHOTO_SET_IDS,
  PHOTO_SETS,
} from "./photoSets";
import { loadSeedPhotos } from "./scenerySeeds";
import { getSceneryPool } from "./sceneryStore";

describe("photo sets", () => {
  it("names five catalogs and snaps unknown ids to World Scenery", () => {
    expect(PHOTO_SET_IDS).toEqual([
      "world-scenery",
      "night-cities",
      "deep-forest",
      "night-sky",
      "grand-buildings",
    ]);
    expect(PHOTO_SETS.map((set) => set.id)).toEqual(PHOTO_SET_IDS);
    expect(isPhotoSetId("night-cities")).toBe(true);
    expect(isPhotoSetId("boring")).toBe(false);
    expect(parsePhotoSetId("grand-buildings")).toBe("grand-buildings");
    expect(parsePhotoSetId("grove")).toBe(DEFAULT_PHOTO_SET_ID);
  });

  it("ships a catalog and a seed pool for every set", async () => {
    for (const id of PHOTO_SET_IDS) {
      expect(PHOTO_SET_CATALOGS[id].length).toBeGreaterThan(30);
      const seed = await loadSeedPhotos(id);
      expect(seed.length, id).toBeGreaterThan(100);
      const ids = new Set(seed.map((photo) => photo.id));
      expect(ids.size).toBe(seed.length);
      const pool = getSceneryPool([], seed);
      expect(pool.length).toBe(seed.length);
    }
  });

  it("keeps World Scenery larger than the other sets", async () => {
    const world = await loadSeedPhotos("world-scenery");
    const cities = await loadSeedPhotos("night-cities");
    expect(world.length).toBeGreaterThan(800);
    expect(cities.length).toBeGreaterThan(100);
    expect(world.length).toBeGreaterThan(cities.length);
  });
});
