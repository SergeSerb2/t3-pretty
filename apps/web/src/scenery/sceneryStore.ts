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

import type { ThreadSceneryAssignment, ThreadSceneryPhoto } from "@t3tools/contracts";

import { createDebouncedStorage } from "../lib/storage";
import { WORLD_SCENERY_CATALOG } from "./catalog";
import { clampTranslucency, DEFAULT_TRANSLUCENCY } from "./glass";
import { stableIndex } from "./palette";
import seedPoolJson from "./seedPool.json";
import { makeUnsplashClient, type SceneryPhoto } from "./unsplash";

const SCENERY_STORAGE_KEY = "t3code:scenery:v1";
const SCENERY_STORAGE_VERSION = 2;

/** CDN pre-blur (imgix `blur`), 0–100. 50 is the SurgeCode mobile bake. */
export const BLUR_RANGE = { lowerBound: 0, upperBound: 100 } as const;
export const DEFAULT_BLUR = 50;

export function clampBlur(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_BLUR;
  }
  return Math.min(Math.max(Math.round(value), BLUR_RANGE.lowerBound), BLUR_RANGE.upperBound);
}

/**
 * How chat ink (text color) is chosen while the theme is active:
 * - auto  — per thread, from the photo's average color + blur + translucency
 * - light — always white text (the dark variant stack)
 * - dark  — always black text (the light variant stack)
 * - off   — follow the app appearance, the pre-ink behavior
 */
export type SceneryInkMode = "auto" | "light" | "dark" | "off";

const INK_MODES: ReadonlySet<SceneryInkMode> = new Set(["auto", "light", "dark", "off"]);

/**
 * How many of the most recent assignments a random pick avoids repeating.
 * SurgeCode excluded photos bound to open/unsettled threads; the web port
 * approximates that with a recency window, which converges to the same
 * behavior for the pool sizes involved (hundreds of photos).
 */
const RECENT_EXCLUSION_WINDOW = 60;

/**
 * Thread routes come and go without a deletion signal reaching this store, so
 * assignments are LRU-capped instead of pruned by event. Old threads that
 * fall out re-resolve through the deterministic hash fallback.
 */
const MAX_ASSIGNMENTS = 300;

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
  /** Photo ids whose download_location ping succeeded (Unsplash guideline). */
  registeredDownloads: string[];
  /** Window glass 0.5–1.0; how much of the window the app paints over the photo. */
  translucency: number;
  /** CDN pre-blur strength 0–100 applied to the wallpaper render. */
  blur: number;
  /** Chat ink selection policy (see SceneryInkMode). */
  inkMode: SceneryInkMode;
  /** Layer the landscape into 2.5D depth cards that follow the pointer. */
  depthEffects: boolean;
  ensureAssignment: (threadKey: string) => void;
  registerDisplayed: (photo: SceneryPhoto) => void;
  refreshPoolIfStale: () => Promise<void>;
  setTranslucency: (value: number) => void;
  setBlur: (value: number) => void;
  setInkMode: (mode: SceneryInkMode) => void;
  setDepthEffects: (enabled: boolean) => void;
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

/**
 * Rebuild a renderable photo from the server-synced assignment. The payload
 * is denormalized precisely so this works when the photo is not in the local
 * pool (fetched pools diverge per device).
 */
export function photoFromAssignment(assignment: ThreadSceneryAssignment): SceneryPhoto {
  return {
    id: assignment.photoId,
    name: assignment.name,
    averageColorHex: assignment.averageColorHex,
    heroURL: assignment.heroURL,
    thumbURL: assignment.thumbURL,
    rawURL: assignment.rawURL,
    downloadLocationURL: assignment.downloadLocationURL,
    photographerName: assignment.photographerName,
    photographerProfileURL: assignment.photographerProfileURL,
  };
}

/** The inverse: what a client sends to bind its picked photo to the thread. */
export function photoToAssignmentPayload(photo: SceneryPhoto): ThreadSceneryPhoto {
  return {
    photoId: photo.id,
    name: photo.name,
    averageColorHex: photo.averageColorHex,
    heroURL: photo.heroURL,
    thumbURL: photo.thumbURL,
    rawURL: photo.rawURL,
    downloadLocationURL: photo.downloadLocationURL,
    photographerName: photo.photographerName,
    photographerProfileURL: photo.photographerProfileURL,
  };
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
 * Deterministic fallback when a thread has no live assignment (LRU-evicted,
 * or the assigned photo left the pool): the same FNV-1a bucket SurgeCode
 * uses. Not persisted — a pool-size change can re-bucket, which is acceptable
 * for threads old enough to have been evicted.
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

function capAssignments(
  assignments: Record<string, SceneryAssignment>,
): Record<string, SceneryAssignment> {
  const entries = Object.entries(assignments);
  if (entries.length <= MAX_ASSIGNMENTS) {
    return assignments;
  }
  entries.sort((left, right) => right[1].assignedAt - left[1].assignedAt);
  return Object.fromEntries(entries.slice(0, MAX_ASSIGNMENTS));
}

let refreshInFlight = false;
const registrationsInFlight = new Set<string>();

export const useSceneryStore = create<SceneryStoreState>()(
  persist(
    (set, get) => ({
      assignments: {},
      fetchedPhotos: [],
      fetchedAt: null,
      refreshCursor: 0,
      registeredDownloads: [],
      translucency: DEFAULT_TRANSLUCENCY,
      blur: DEFAULT_BLUR,
      inkMode: "auto",
      depthEffects: false,
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
            assignments: capAssignments({
              ...state.assignments,
              [threadKey]: { photoId: pick.id, name: pick.name, assignedAt: Date.now() },
            }),
          };
        }),
      registerDisplayed: (photo) => {
        const state = get();
        if (state.registeredDownloads.includes(photo.id) || registrationsInFlight.has(photo.id)) {
          return;
        }
        const client = makeUnsplashClient();
        // The displayed photo carries its registration URL, so the ping works
        // even for a server-synced assignment this device's pool lacks.
        const downloadLocationURL =
          photo.downloadLocationURL ??
          getSceneryPool(state.fetchedPhotos).find((entry) => entry.id === photo.id)
            ?.downloadLocationURL;
        if (!client || !downloadLocationURL) {
          // No key or no registration URL: leave the id unclaimed so the
          // ping happens once a key is available.
          return;
        }
        registrationsInFlight.add(photo.id);
        void client
          .registerDownload(downloadLocationURL)
          .then((registered) => {
            if (!registered) {
              return;
            }
            // Persist only after a successful ping so an offline failure
            // retries on a later display instead of being lost forever.
            set((current) =>
              current.registeredDownloads.includes(photo.id)
                ? current
                : { registeredDownloads: [...current.registeredDownloads, photo.id] },
            );
          })
          .finally(() => {
            registrationsInFlight.delete(photo.id);
          });
      },
      refreshPoolIfStale: async () => {
        const state = get();
        const pool = getSceneryPool(state.fetchedPhotos);
        if (pool.length >= 50 && state.fetchedAt === null) {
          // Seeded install: start the staleness clock; the first network
          // refresh happens once the seed is POOL_STALE_MS old.
          set(() => ({ fetchedAt: Date.now() }));
          return;
        }
        const fresh = state.fetchedAt !== null && Date.now() - state.fetchedAt < POOL_STALE_MS;
        if (pool.length >= 50 && fresh) {
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
      setTranslucency: (value) => set(() => ({ translucency: clampTranslucency(value) })),
      setBlur: (value) => set(() => ({ blur: clampBlur(value) })),
      setInkMode: (mode) => set(() => ({ inkMode: INK_MODES.has(mode) ? mode : "auto" })),
      setDepthEffects: (enabled) => set(() => ({ depthEffects: enabled })),
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
        createDebouncedStorage(
          typeof window !== "undefined" ? window.localStorage : undefined,
          5_000,
        ),
      ),
      partialize: (state) => ({
        assignments: state.assignments,
        fetchedPhotos: state.fetchedPhotos,
        fetchedAt: state.fetchedAt,
        refreshCursor: state.refreshCursor,
        registeredDownloads: state.registeredDownloads,
        translucency: state.translucency,
        blur: state.blur,
        inkMode: state.inkMode,
        depthEffects: state.depthEffects,
      }),
      migrate: (persisted) => {
        const state = persisted as SceneryStoreState;
        return {
          ...state,
          depthEffects: state.depthEffects === true,
        };
      },
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
