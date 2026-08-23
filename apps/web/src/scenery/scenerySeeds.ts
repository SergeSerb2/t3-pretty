import type { PhotoSetId } from "./photoSets";
import worldSeedJson from "./seedPool.json";
import type { SceneryPhoto } from "./unsplash";

type SeedFile = { readonly photos: ReadonlyArray<SceneryPhoto> };

const cache = new Map<PhotoSetId, ReadonlyArray<SceneryPhoto>>();
cache.set("world-scenery", (worldSeedJson as SeedFile).photos);

type SeedModule = {
  photos?: ReadonlyArray<SceneryPhoto>;
  default?: SeedFile;
};

const loaders: Record<PhotoSetId, () => Promise<SeedModule>> = {
  "world-scenery": () => Promise.resolve(worldSeedJson as SeedFile),
  "night-cities": () => import("./seeds/night-cities.json"),
  "deep-forest": () => import("./seeds/deep-forest.json"),
  "night-sky": () => import("./seeds/night-sky.json"),
  "grand-buildings": () => import("./seeds/grand-buildings.json"),
};

function photosFromModule(mod: SeedModule): ReadonlyArray<SceneryPhoto> {
  return mod.photos ?? mod.default?.photos ?? [];
}

export function peekSeedPhotos(photoSetId: PhotoSetId): ReadonlyArray<SceneryPhoto> {
  return cache.get(photoSetId) ?? [];
}

export async function loadSeedPhotos(photoSetId: PhotoSetId): Promise<ReadonlyArray<SceneryPhoto>> {
  const hit = cache.get(photoSetId);
  if (hit && (photoSetId === "world-scenery" || hit.length > 0)) {
    return hit;
  }
  const loaded = photosFromModule(await loaders[photoSetId]());
  cache.set(photoSetId, loaded);
  return loaded;
}
