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

import { createDebouncedStorage, resolveLocalStorage } from "../lib/storage";
import { PHOTO_SET_CATALOGS } from "./catalog";
import { clampTranslucency, DEFAULT_TRANSLUCENCY } from "./glass";
import { stableIndex } from "./palette";
import { DEFAULT_PHOTO_SET_ID, type PhotoSetId } from "./photoSets";
import { usePhotoSetStore } from "./photoSetStore";
import { peekSeedPhotos } from "./scenerySeeds";
import { makeUnsplashClient, sanitizeSceneryPhoto, type SceneryPhoto } from "./unsplash";

const SCENERY_STORAGE_KEY = "t3code:scenery:v1";
const SCENERY_STORAGE_VERSION = 2;

const sceneryDebouncedStorage = createDebouncedStorage(resolveLocalStorage(), 5_000);
const flushSceneryState = () => sceneryDebouncedStorage.flush();

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", flushSceneryState);
  window.addEventListener("beforeunload", flushSceneryState);
  import.meta.hot?.dispose(() => {
    flushSceneryState();
    window.removeEventListener("pagehide", flushSceneryState);
    window.removeEventListener("beforeunload", flushSceneryState);
  });
}

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
 * Capped at half the pool so extra themes (~100+ photos) still have
 * candidates; World Scenery (~950) keeps the full 120.
 */
const RECENT_EXCLUSION_WINDOW = 120;

/**
 * Thread routes come and go without a deletion signal reaching this store, so
 * assignments are LRU-capped instead of pruned by event. Old threads that
 * fall out re-resolve through the deterministic hash fallback.
 */
const MAX_ASSIGNMENTS = 300;

/** Bound the persisted runtime pool; assigned photos win over older unreferenced entries. */
const MAX_FETCHED_PHOTOS = 768;

/** Old registrations may retry after eviction, which is harmless and preferable to unbounded state. */
const MAX_REGISTERED_DOWNLOADS = 1_024;

/** Refresh the fetched pool when it is this stale (SurgeCode: 14 days). */
const POOL_STALE_MS = 14 * 24 * 60 * 60 * 1000;

/** Locations fetched per refresh run — safe under the 50 req/hour demo cap. */
const REFRESH_BATCH_LOCATIONS = 24;

/** Photos pulled per location during a refresh (Unsplash search page 1). */
const REFRESH_PHOTOS_PER_LOCATION = 8;

const EMPTY_PHOTOS: ReadonlyArray<SceneryPhoto> = [];

export interface SceneryAssignment {
  readonly photoId: string;
  /** Curated "Location, Country" name, denormalized for display. */
  readonly name: string;
  readonly assignedAt: number;
}

interface SceneryStoreState {
  assignments: Record<string, SceneryAssignment>;
  /**
   * Runtime Unsplash hits keyed by photo set. Merged over that set's bundled
   * seed. Legacy `fetchedPhotos` migrates into the World Scenery bucket.
   */
  fetchedBySet: Partial<Record<PhotoSetId, SceneryPhoto[]>>;
  fetchedAtBySet: Partial<Record<PhotoSetId, number | null>>;
  /** Next catalog index a refresh run continues from, per photo set. */
  refreshCursorBySet: Partial<Record<PhotoSetId, number>>;
  /** Photo ids whose download_location ping succeeded (Unsplash guideline). */
  registeredDownloads: string[];
  /** Window glass 0.5–1.0; how much of the window the app paints over the photo. */
  translucency: number;
  /** CDN pre-blur strength 0–100 applied to the wallpaper render. */
  blur: number;
  /** Chat ink selection policy (see SceneryInkMode). */
  inkMode: SceneryInkMode;
  ensureAssignment: (threadKey: string) => void;
  registerDisplayed: (photo: SceneryPhoto) => void;
  refreshPoolIfStale: () => Promise<void>;
  setTranslucency: (value: number) => void;
  setBlur: (value: number) => void;
  setInkMode: (mode: SceneryInkMode) => void;
  removeThread: (threadKey: string) => void;
}

type PersistedSceneryStoreState = Pick<
  SceneryStoreState,
  | "assignments"
  | "fetchedBySet"
  | "fetchedAtBySet"
  | "refreshCursorBySet"
  | "registeredDownloads"
  | "translucency"
  | "blur"
  | "inkMode"
>;

export function activePhotoSetId(): PhotoSetId {
  return usePhotoSetStore.getState().photoSetId;
}

export function getSceneryPool(
  fetchedPhotos: ReadonlyArray<SceneryPhoto>,
  seedPhotos: ReadonlyArray<SceneryPhoto> = peekSeedPhotos(DEFAULT_PHOTO_SET_ID),
): SceneryPhoto[] {
  const byId = new Map<string, SceneryPhoto>();
  for (const photo of seedPhotos) {
    byId.set(photo.id, photo);
  }
  for (const photo of fetchedPhotos) {
    byId.set(photo.id, photo);
  }
  return [...byId.values()];
}

function poolForActiveSet(state: {
  fetchedBySet: Partial<Record<PhotoSetId, SceneryPhoto[]>>;
}): SceneryPhoto[] {
  const photoSetId = activePhotoSetId();
  return getSceneryPool(state.fetchedBySet[photoSetId] ?? EMPTY_PHOTOS, peekSeedPhotos(photoSetId));
}

/**
 * Rebuild a renderable photo from the server-synced assignment. The payload
 * is denormalized precisely so this works when the photo is not in the local
 * pool (fetched pools diverge per device).
 */
export function photoFromAssignment(assignment: ThreadSceneryAssignment): SceneryPhoto | null {
  return sanitizeSceneryPhoto({
    id: assignment.photoId,
    name: assignment.name,
    averageColorHex: assignment.averageColorHex,
    heroURL: assignment.heroURL,
    thumbURL: assignment.thumbURL,
    rawURL: assignment.rawURL,
    downloadLocationURL: assignment.downloadLocationURL,
    photographerName: assignment.photographerName,
    photographerProfileURL: assignment.photographerProfileURL,
  });
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
    .slice(0, Math.min(RECENT_EXCLUSION_WINDOW, Math.floor(pool.length / 2)));
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

function capFetchedPhotos(
  photos: ReadonlyArray<SceneryPhoto>,
  assignments: Readonly<Record<string, SceneryAssignment>>,
): SceneryPhoto[] {
  const byId = new Map<string, SceneryPhoto>();
  for (const photo of photos) {
    byId.delete(photo.id);
    byId.set(photo.id, photo);
  }
  const uniquePhotos = [...byId.values()];
  if (uniquePhotos.length <= MAX_FETCHED_PHOTOS) {
    return uniquePhotos;
  }

  const assignedIds = new Set(Object.values(assignments).map((assignment) => assignment.photoId));
  const retainedIds = new Set(
    uniquePhotos.filter((photo) => assignedIds.has(photo.id)).map((photo) => photo.id),
  );
  for (
    let index = uniquePhotos.length - 1;
    index >= 0 && retainedIds.size < MAX_FETCHED_PHOTOS;
    index--
  ) {
    retainedIds.add(uniquePhotos[index]!.id);
  }
  return uniquePhotos.filter((photo) => retainedIds.has(photo.id));
}

function isSceneryAssignment(value: unknown): value is SceneryAssignment {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SceneryAssignment>;
  return (
    typeof candidate.photoId === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.assignedAt === "number" &&
    Number.isFinite(candidate.assignedAt)
  );
}

function normalizeAssignments(value: unknown): Record<string, SceneryAssignment> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return capAssignments(
    Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, SceneryAssignment] =>
        isSceneryAssignment(entry[1]),
      ),
    ),
  );
}

function normalizeRegisteredDownloads(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const recentIds: string[] = [];
  const seen = new Set<string>();
  for (
    let index = value.length - 1;
    index >= 0 && recentIds.length < MAX_REGISTERED_DOWNLOADS;
    index--
  ) {
    const id = value[index];
    if (typeof id !== "string" || id.length === 0 || id.length > 128 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    recentIds.push(id);
  }
  recentIds.reverse();
  return recentIds;
}

const PHOTO_SET_IDS = Object.keys(PHOTO_SET_CATALOGS) as PhotoSetId[];

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeFetchedBySet(
  value: unknown,
  assignments: Readonly<Record<string, SceneryAssignment>>,
): Partial<Record<PhotoSetId, SceneryPhoto[]>> {
  const source = recordValue(value);
  if (!source) return {};
  const normalized: Partial<Record<PhotoSetId, SceneryPhoto[]>> = {};
  for (const photoSetId of PHOTO_SET_IDS) {
    const rawPhotos = source[photoSetId];
    if (!Array.isArray(rawPhotos)) continue;
    const photos = rawPhotos.flatMap((candidate) => {
      const photo = sanitizeSceneryPhoto(candidate);
      return photo ? [photo] : [];
    });
    normalized[photoSetId] = capFetchedPhotos(photos, assignments);
  }
  return normalized;
}

function normalizeFetchedAtBySet(
  value: unknown,
): Partial<Record<PhotoSetId, number | null>> {
  const source = recordValue(value);
  if (!source) return {};
  const normalized: Partial<Record<PhotoSetId, number | null>> = {};
  for (const photoSetId of PHOTO_SET_IDS) {
    const fetchedAt = source[photoSetId];
    if (fetchedAt === null || (typeof fetchedAt === "number" && Number.isFinite(fetchedAt))) {
      normalized[photoSetId] = fetchedAt;
    }
  }
  return normalized;
}

function normalizeRefreshCursorBySet(value: unknown): Partial<Record<PhotoSetId, number>> {
  const source = recordValue(value);
  if (!source) return {};
  const normalized: Partial<Record<PhotoSetId, number>> = {};
  for (const photoSetId of PHOTO_SET_IDS) {
    const cursor = source[photoSetId];
    const catalogLength = PHOTO_SET_CATALOGS[photoSetId].length;
    if (typeof cursor !== "number" || !Number.isFinite(cursor) || catalogLength === 0) continue;
    normalized[photoSetId] = Math.max(0, Math.trunc(cursor)) % catalogLength;
  }
  return normalized;
}

/** Normalize persisted data on every hydration, including the legacy single-pool shape. */
export function migratePersistedSceneryState(persistedState: unknown): PersistedSceneryStoreState {
  const candidate = recordValue(persistedState) ?? {};
  const assignments = normalizeAssignments(candidate.assignments);
  const fetchedBySetSource =
    recordValue(candidate.fetchedBySet) ?? { [DEFAULT_PHOTO_SET_ID]: candidate.fetchedPhotos };
  const fetchedAtBySetSource =
    recordValue(candidate.fetchedAtBySet) ?? { [DEFAULT_PHOTO_SET_ID]: candidate.fetchedAt };
  const refreshCursorBySetSource =
    recordValue(candidate.refreshCursorBySet) ?? {
      [DEFAULT_PHOTO_SET_ID]: candidate.refreshCursor,
    };
  return {
    assignments,
    fetchedBySet: normalizeFetchedBySet(fetchedBySetSource, assignments),
    fetchedAtBySet: normalizeFetchedAtBySet(fetchedAtBySetSource),
    refreshCursorBySet: normalizeRefreshCursorBySet(refreshCursorBySetSource),
    registeredDownloads: normalizeRegisteredDownloads(candidate.registeredDownloads),
    translucency:
      typeof candidate.translucency === "number"
        ? clampTranslucency(candidate.translucency)
        : DEFAULT_TRANSLUCENCY,
    blur: typeof candidate.blur === "number" ? clampBlur(candidate.blur) : DEFAULT_BLUR,
    inkMode:
      typeof candidate.inkMode === "string" && INK_MODES.has(candidate.inkMode as SceneryInkMode)
        ? (candidate.inkMode as SceneryInkMode)
        : "auto",
  };
}

function mergePersistedSceneryState(
  persistedState: unknown,
  currentState: SceneryStoreState,
): SceneryStoreState {
  return { ...currentState, ...migratePersistedSceneryState(persistedState) };
}

let refreshInFlight = false;
const registrationsInFlight = new Set<string>();

export const useSceneryStore = create<SceneryStoreState>()(
  persist(
    (set, get) => ({
      assignments: {},
      fetchedBySet: {},
      fetchedAtBySet: {},
      refreshCursorBySet: {},
      registeredDownloads: [],
      translucency: DEFAULT_TRANSLUCENCY,
      blur: DEFAULT_BLUR,
      inkMode: "auto",
      ensureAssignment: (threadKey) =>
        set((state) => {
          const pool = poolForActiveSet(state);
          const existing = state.assignments[threadKey];
          if (existing && pool.some((entry) => entry.id === existing.photoId)) {
            return state;
          }
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
          poolForActiveSet(state).find((entry) => entry.id === photo.id)?.downloadLocationURL;
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
                : {
                    registeredDownloads: [...current.registeredDownloads, photo.id].slice(
                      -MAX_REGISTERED_DOWNLOADS,
                    ),
                  },
            );
          })
          .finally(() => {
            registrationsInFlight.delete(photo.id);
          });
      },
      refreshPoolIfStale: async () => {
        const photoSetId = activePhotoSetId();
        const catalog = PHOTO_SET_CATALOGS[photoSetId];
        const state = get();
        const pool = poolForActiveSet(state);
        const fetchedAt = state.fetchedAtBySet[photoSetId] ?? null;
        if (pool.length >= 50 && fetchedAt === null) {
          // Seeded install: start the staleness clock; the first network
          // refresh happens once the seed is POOL_STALE_MS old.
          set(() => ({ fetchedAtBySet: { ...get().fetchedAtBySet, [photoSetId]: Date.now() } }));
          return;
        }
        const fresh = fetchedAt !== null && Date.now() - fetchedAt < POOL_STALE_MS;
        if (pool.length >= 50 && fresh) {
          return;
        }
        const client = makeUnsplashClient();
        if (!client || refreshInFlight || catalog.length === 0) {
          return;
        }
        refreshInFlight = true;
        try {
          const start = (get().refreshCursorBySet[photoSetId] ?? 0) % catalog.length;
          const batch = Array.from(
            { length: Math.min(REFRESH_BATCH_LOCATIONS, catalog.length) },
            (_, index) => catalog[(start + index) % catalog.length]!,
          );
          const results = await Promise.allSettled(
            batch.map(async (location) => {
              const photos = await client.searchPhotos(location.query, REFRESH_PHOTOS_PER_LOCATION);
              // The curated name is the display name — never the Unsplash
              // caption, which is machine prose.
              return photos.map((photo) => ({ ...photo, name: location.name }));
            }),
          );
          const fetched = results.flatMap((result) =>
            result.status === "fulfilled" ? result.value : [],
          );
          if (!results.some((result) => result.status === "fulfilled")) {
            return;
          }
          set((current) => {
            const existing = current.fetchedBySet[photoSetId] ?? [];
            const byId = new Map(existing.map((photo) => [photo.id, photo]));
            for (const photo of fetched) {
              byId.delete(photo.id);
              byId.set(photo.id, photo);
            }
            return {
              fetchedBySet: {
                ...current.fetchedBySet,
                [photoSetId]: capFetchedPhotos([...byId.values()], current.assignments),
              },
              fetchedAtBySet: { ...current.fetchedAtBySet, [photoSetId]: Date.now() },
              refreshCursorBySet: {
                ...current.refreshCursorBySet,
                [photoSetId]: (start + REFRESH_BATCH_LOCATIONS) % catalog.length,
              },
            };
          });
        } finally {
          refreshInFlight = false;
        }
      },
      setTranslucency: (value) => set(() => ({ translucency: clampTranslucency(value) })),
      setBlur: (value) => set(() => ({ blur: clampBlur(value) })),
      setInkMode: (mode) => set(() => ({ inkMode: INK_MODES.has(mode) ? mode : "auto" })),
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
      storage: createJSONStorage(() => sceneryDebouncedStorage),
      partialize: (state) => ({
        assignments: state.assignments,
        fetchedBySet: state.fetchedBySet,
        fetchedAtBySet: state.fetchedAtBySet,
        refreshCursorBySet: state.refreshCursorBySet,
        registeredDownloads: state.registeredDownloads,
        translucency: state.translucency,
        blur: state.blur,
        inkMode: state.inkMode,
      }),
      migrate: migratePersistedSceneryState,
      merge: mergePersistedSceneryState,
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
