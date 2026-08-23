/**
 * Assign a thread its photo and start decoding the wallpaper. Called from
 * the scenery chunk when a new-thread navigation is about to happen, so the
 * image is already decoded by the time the draft route paints.
 *
 * Keep this module out of the startup graph: the seed pool lives here.
 */
import { usePhotoSetStore } from "./photoSetStore";
import { loadSeedPhotos, peekSeedPhotos } from "./scenerySeeds";
import { fallbackPhoto, getSceneryPool, useSceneryStore } from "./sceneryStore";
import { preloadWallpaper } from "./sceneryWallpaper";
import { wallpaperURL } from "./unsplash";

export function primeSceneryForThread(threadKey: string): void {
  const persist = useSceneryStore.persist;
  if (persist?.hasHydrated?.() === false) {
    persist.onFinishHydration?.(() => primeSceneryForThread(threadKey));
    return;
  }

  const photoSetId = usePhotoSetStore.getState().photoSetId;
  void loadSeedPhotos(photoSetId).then(() => {
    const store = useSceneryStore.getState();
    store.ensureAssignment(threadKey);
    const state = useSceneryStore.getState();
    const assignment = state.assignments[threadKey];
    const pool = getSceneryPool(state.fetchedBySet[photoSetId] ?? [], peekSeedPhotos(photoSetId));
    const photo = assignment
      ? (pool.find((entry) => entry.id === assignment.photoId) ?? fallbackPhoto(pool, threadKey))
      : fallbackPhoto(pool, threadKey);
    if (!photo) {
      return;
    }
    void preloadWallpaper(wallpaperURL(photo, state.blur));
  });
}
