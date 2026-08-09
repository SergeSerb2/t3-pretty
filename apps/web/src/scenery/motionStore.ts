/**
 * Motion preference for the fork's animation layer. Deliberately its own
 * tiny persisted store — SceneryMotion mounts theme-independent at startup,
 * and importing sceneryStore from that chunk would drag the 400 KB seed
 * pool into the always-loaded bundle.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";

const MOTION_STORAGE_KEY = "t3code:scenery-motion:v1";

interface MotionStoreState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useMotionStore = create<MotionStoreState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set(() => ({ enabled })),
    }),
    {
      name: MOTION_STORAGE_KEY,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ enabled: state.enabled }),
    },
  ),
);
