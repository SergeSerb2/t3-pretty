import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_PHOTO_SET_ID } from "./photoSets";
import type { SceneryPhoto } from "./unsplash";
import { migratePersistedSceneryState } from "./sceneryStore";

function photo(id: string): SceneryPhoto {
  return {
    id,
    name: id,
    averageColorHex: null,
    heroURL: `https://images.unsplash.com/${id}/hero`,
    thumbURL: `https://images.unsplash.com/${id}/thumb`,
    rawURL: null,
    downloadLocationURL: null,
    photographerName: "Photographer",
    photographerProfileURL: null,
  };
}

describe("migratePersistedSceneryState", () => {
  it("caps hydrated photo and registration caches while retaining assigned photos", () => {
    const fetchedPhotos = Array.from({ length: 900 }, (_, index) => photo(`photo-${index}`));
    const registeredDownloads = Array.from({ length: 1_100 }, (_, index) => `download-${index}`);

    const migrated = migratePersistedSceneryState({
      assignments: {
        assigned: { photoId: "photo-0", name: "Assigned", assignedAt: 1 },
      },
      fetchedPhotos,
      registeredDownloads,
    });

    const migratedPhotos = migrated.fetchedBySet[DEFAULT_PHOTO_SET_ID] ?? [];
    expect(migratedPhotos).toHaveLength(768);
    expect(migratedPhotos.some((entry) => entry.id === "photo-0")).toBe(true);
    expect(migratedPhotos.some((entry) => entry.id === "photo-899")).toBe(true);
    expect(migrated.registeredDownloads).toHaveLength(1_024);
    expect(migrated.registeredDownloads.at(0)).toBe("download-76");
    expect(migrated.registeredDownloads.at(-1)).toBe("download-1099");
  });

  it("drops malformed cache entries and keeps the newest duplicate", () => {
    const original = photo("duplicate");
    const replacement = { ...original, name: "Replacement" };

    const migrated = migratePersistedSceneryState({
      assignments: { invalid: { photoId: "bad", name: "Bad", assignedAt: Number.NaN } },
      fetchedPhotos: [original, null, replacement],
      registeredDownloads: ["registered", 42, "registered"],
    });

    expect(migrated.assignments).toEqual({});
    expect(migrated.fetchedBySet[DEFAULT_PHOTO_SET_ID]).toEqual([replacement]);
    expect(migrated.registeredDownloads).toEqual(["registered"]);
  });

  it("drops persisted executable and off-origin Unsplash metadata", () => {
    const valid = photo("valid");
    const migrated = migratePersistedSceneryState({
      fetchedPhotos: [
        valid,
        { ...photo("script"), heroURL: "javascript:alert(1)" },
        { ...photo("leak"), downloadLocationURL: "https://example.com/collect" },
        { ...photo("profile"), photographerProfileURL: "javascript:alert(1)" },
      ],
    });

    expect(migrated.fetchedBySet[DEFAULT_PHOTO_SET_ID]).toEqual([valid]);
  });
});
