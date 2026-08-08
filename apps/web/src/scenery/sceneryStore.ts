/**
 * World scenery engine: pool, per-thread photo assignment, random pick, and
 * Unsplash compliance bookkeeping. Port of the relevant slice of SurgeCode
 * v0.2.7 `SceneryStore.swift`, shaped like the app's other per-thread zustand
 * stores (see rightPanelStore.ts).
 *
 * The pool is the bundled seed (exported from the SurgeCode cache at fork
 * build time) merged with any photos fetched at runtime. Assignment happens
 * on first sight of a thread key: since a brand-new thread navigates to its
 * route immediately, first-visit assignment is equivalent to pick-at-creation.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";
import { WORLD_SCENERY_CATALOG } from "./catalog";
import { stableIndex } from "./palette";
import seedPoolJson from "./seedPool.json";
import { makeUnsplashClient, type SceneryPhoto } from "./unsplash";

const SCENERY_STORAGE_KEY = "t3code:scenery:v1";
const SCENERY_STORAGE_VERSION = 1;

/**
 * How many of the most recent assignments a random pick avoids repeating.
 * SurgeCode excluded photos bound to open/unsettled threads; the web port
 * approximates that with a recency window, which converges to the same
 * behavior for the pool sizes involved (hundreds of photos).
 */
const RECENT_EXCLUSION_WINDOW = 60;

/** Refresh the fetched pool when it is this stale (SurgeCode: 14 days). */
const POOL_STALE_MS = 14 * 24 * 60 * 60 * 1000;

/** Locations fetched per refresh run — safe under the 50 req/hour demo cap. */
const REFRESH_BATCH_LOCATIONS = 24;

const SEED_POOL: ReadonlyArray<SceneryPhoto> = (
  seedPoolJson as { photos: ReadonlyArray<SceneryPhoto> }
).photos;

export interface SceneryAssignment {
  readonly photoId: string;
  /** Curated "Location, Country" name, denormalized for display. */
  readonly name: string;
  readonly assignedAt: number;
}

interface SceneryStoreState {
  assignments: Record<string, SceneryAssignment>;
  /** Photos fetched at runtime; merged over the bundled seed pool. */
  fetchedPhotos: SceneryPhoto[];
  fetchedAt: number | null;
  /** Next catalog index a refresh run continues from. */
  refreshCursor: number;
  /** Photo ids whose download_location has been pinged (Unsplash guideline). */
  registeredDownloads: string[];
  /** Window glass 0.5–1.0; how much of the window the app paints over the photo. */
  translucency: number;
  ensureAssignment: (threadKey: string) => void;
  registerDisplayed: (photoId: string) => void;
  refreshPoolIfStale: () => Promise<void>;
  setTranslucency: (value: number) => void;
  removeThread: (threadKey: string) => void;
}

export function getSceneryPool(fetchedPhotos: ReadonlyArray<SceneryPhoto>): SceneryPhoto[] {
  const byId = new Map<string, SceneryPhoto>();
  for (const photo of SEED_POOL) {
    byId.set(photo.id, photo);
  }
  for (const photo of fetchedPhotos) {
    byId.set(photo.id, photo);
  }
  return [...byId.values()];
}

export function pickScenery(
  pool: ReadonlyArray<SceneryPhoto>,
  assignments: Record<string, SceneryAssignment>,
): SceneryPhoto | null {
  if (pool.length === 0) {
    return null;
  }
  const recent = Object.values(assignments)
    .sort((left, right) => right.assignedAt - left.assignedAt)
    .slice(0, RECENT_EXCLUSION_WINDOW);
  const occupied = new Set(recent.map((assignment) => assignment.photoId));
  const available = pool.filter((photo) => !occupied.has(photo.id));
  const candidates = available.length > 0 ? available : pool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

/**
 * Deterministic fallback when an assignment references a photo that left the
 * pool: the same FNV-1a bucket SurgeCode uses, pinned back into the store so
 * pool growth cannot reshuffle it.
 */
export function fallbackPhoto(
  pool: ReadonlyArray<SceneryPhoto>,
  threadKey: string,
): SceneryPhoto | null {
  if (pool.length === 0) {
    return null;
  }
  return pool[stableIndex(threadKey, pool.length)] ?? null;
}

let refreshInFlight = false;

export const useSceneryStore = create<SceneryStoreState>()(
  persist(
    (set, get) => ({
      assignments: {},
      fetchedPhotos: [],
      fetchedAt: null,
      refreshCursor: 0,
      registeredDownloads: [],
      translucency: 0.85,
      ensureAssignment: (threadKey) =>
        set((state) => {
          if (state.assignments[threadKey]) {
            return state;
          }
          const pool = getSceneryPool(state.fetchedPhotos);
          const pick = pickScenery(pool, state.assignments);
          if (!pick) {
            return state;
          }
          return {
            assignments: {
              ...state.assignments,
              [threadKey]: { photoId: pick.id, name: pick.name, assignedAt: Date.now() },
            },
          };
        }),
      registerDisplayed: (photoId) => {
        const state = get();
        if (state.registeredDownloads.includes(photoId)) {
          return;
        }
        // Claim before the request suspends so a re-render cannot double-ping.
        set((current) =>
          current.registeredDownloads.includes(photoId)
            ? current
            : { registeredDownloads: [...current.registeredDownloads, photoId] },
        );
        const photo = getSceneryPool(state.fetchedPhotos).find((entry) => entry.id === photoId);
        const client = makeUnsplashClient();
        if (photo?.downloadLocationURL && client) {
          void client.registerDownload(photo.downloadLocationURL);
        }
      },
      refreshPoolIfStale: async () => {
        const state = get();
        const pool = getSceneryPool(state.fetchedPhotos);
        const fresh = state.fetchedAt !== null && Date.now() - state.fetchedAt < POOL_STALE_MS;
        // The bundled seed already covers the catalog; only hit the network
        // when the pool is thin or a previous refresh has gone stale.
        if (pool.length >= 50 && fresh) {
          return;
        }
        if (pool.length >= 50 && state.fetchedAt === null && SEED_POOL.length >= 50) {
          // Seed-only pool is complete enough; skip the initial network run.
          return;
        }
        const client = makeUnsplashClient();
        if (!client || refreshInFlight) {
          return;
        }
        refreshInFlight = true;
        try {
          const start = get().refreshCursor % WORLD_SCENERY_CATALOG.length;
          const batch = Array.from(
            { length: Math.min(REFRESH_BATCH_LOCATIONS, WORLD_SCENERY_CATALOG.length) },
            (_, index) => WORLD_SCENERY_CATALOG[(start + index) % WORLD_SCENERY_CATALOG.length]!,
          );
          const results = await Promise.allSettled(
            batch.map(async (location) => {
              const photos = await client.searchPhotos(location.query, 2);
              // The curated name is the display name — never the Unsplash
              // caption, which is machine prose.
              return photos.map((photo) => ({ ...photo, name: location.name }));
            }),
          );
          const fetched = results.flatMap((result) =>
            result.status === "fulfilled" ? result.value : [],
          );
          set((current) => {
            const byId = new Map(current.fetchedPhotos.map((photo) => [photo.id, photo]));
            for (const photo of fetched) {
              byId.set(photo.id, photo);
            }
            return {
              fetchedPhotos: [...byId.values()],
              fetchedAt: Date.now(),
              refreshCursor: (start + REFRESH_BATCH_LOCATIONS) % WORLD_SCENERY_CATALOG.length,
            };
          });
        } finally {
          refreshInFlight = false;
        }
      },
      setTranslucency: (value) => set(() => ({ translucency: Math.min(Math.max(value, 0.5), 1) })),
      removeThread: (threadKey) =>
        set((state) => {
          if (!(threadKey in state.assignments)) {
            return state;
          }
          const { [threadKey]: _removed, ...rest } = state.assignments;
          return { assignments: rest };
        }),
    }),
    {
      name: SCENERY_STORAGE_KEY,
      version: SCENERY_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        assignments: state.assignments,
        fetchedPhotos: state.fetchedPhotos,
        fetchedAt: state.fetchedAt,
        refreshCursor: state.refreshCursor,
        registeredDownloads: state.registeredDownloads,
        translucency: state.translucency,
      }),
    },
  ),
);

/** Day key for the signed-out / no-thread hero rotation. */
export function dailySeed(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `daily|${year}-${month}-${day}`;
}

export function dailyFeatured(
  pool: ReadonlyArray<SceneryPhoto>,
  seed: string,
): SceneryPhoto | null {
  if (pool.length === 0) {
    return null;
  }
  return pool[stableIndex(seed, pool.length)] ?? null;
}
