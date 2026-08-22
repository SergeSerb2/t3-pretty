/**
 * Which photo catalog is active. Kept out of sceneryStore so Settings can
 * switch sets without pulling the seed pool into the settings chunk.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDebouncedStorage } from "../lib/storage";
import {
  DEFAULT_PHOTO_SET_ID,
  parsePhotoSetId,
  PHOTO_SET_STORAGE_KEY,
  type PhotoSetId,
} from "./photoSets";

interface PhotoSetState {
  photoSetId: PhotoSetId;
  setPhotoSetId: (photoSetId: PhotoSetId) => void;
}

export const usePhotoSetStore = create<PhotoSetState>()(
  persist(
    (set) => ({
      photoSetId: DEFAULT_PHOTO_SET_ID,
      setPhotoSetId: (photoSetId) => set({ photoSetId: parsePhotoSetId(photoSetId) }),
    }),
    {
      name: PHOTO_SET_STORAGE_KEY,
      storage: createJSONStorage(() =>
        createDebouncedStorage(
          typeof window !== "undefined" ? window.localStorage : undefined,
          500,
        ),
      ),
      partialize: (state) => ({ photoSetId: state.photoSetId }),
      merge: (persisted, current) => ({
        ...current,
        photoSetId: parsePhotoSetId(
          (persisted as { photoSetId?: unknown } | undefined)?.photoSetId,
        ),
      }),
    },
  ),
);
