/**
 * React face of the mobile World Scenery engine. Follows the
 * AppearancePreferencesProvider pattern: the scenery slice lives in the
 * device preferences blob (mobile-preferences.ts) and is patched through the
 * optimistic preferences atoms.
 *
 * Assignment parity with the desktop theme: a photo is bound to a thread key
 * ("<environmentId>:<threadId>") on first sight — since a brand-new thread
 * opens its route immediately, first-visit assignment is equivalent to
 * pick-at-creation. Evicted/missing assignments re-resolve through the
 * deterministic FNV-1a fallback, so a thread never loses its scenery.
 */
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";

import { isBoringMobileTheme } from "../../lib/mobileTheme";
import type { MobileSceneryPreferences } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { DEFAULT_PHOTO_SET_ID, parsePhotoSetId, type PhotoSetId } from "./photoSets";
import { useReduceTransparency } from "./useReduceTransparency";
import {
  capAssignments,
  clampBlur,
  clampTranslucency,
  dailyFeatured,
  dailySeed,
  DEFAULT_BLUR,
  DEFAULT_TRANSLUCENCY,
  fallbackPhoto,
  getSceneryPool,
  loadSeedPhotos,
  peekSeedPhotos,
  pickScenery,
  sceneryPoolForSet,
  type SceneryAssignment,
  type SceneryPhoto,
} from "./sceneryLogic";

export interface ResolvedScenery {
  readonly enabled: boolean;
  readonly blur: number;
  readonly translucency: number;
  readonly photoSetId: PhotoSetId;
  readonly assignments: Readonly<Record<string, SceneryAssignment>>;
}

function resolveScenery(raw: MobileSceneryPreferences | null | undefined): ResolvedScenery {
  return {
    enabled: raw?.enabled ?? true,
    blur: clampBlur(raw?.blur ?? DEFAULT_BLUR),
    translucency: clampTranslucency(raw?.translucency ?? DEFAULT_TRANSLUCENCY),
    photoSetId: parsePhotoSetId(raw?.photoSetId),
    assignments: raw?.assignments ?? {},
  };
}

interface SceneryContextValue extends ResolvedScenery {
  readonly isReady: boolean;
  /** Assigned photo for a thread key, or the deterministic hash fallback. */
  readonly photoForThreadKey: (threadKey: string) => SceneryPhoto | null;
  /** Today's featured photo for the no-thread home screen. */
  readonly dailyPhoto: SceneryPhoto | null;
  /** Bind a photo to a thread key on first sight; no-op afterwards. */
  readonly ensureThreadAssignment: (threadKey: string) => void;
  readonly setEnabled: (value: boolean) => void;
  readonly setBlur: (value: number) => void;
  readonly setTranslucency: (value: number) => void;
  readonly setPhotoSetId: (value: PhotoSetId) => void;
}

const SceneryContext = createContext<SceneryContextValue | null>(null);

export function SceneryProvider(props: { readonly children: ReactNode }) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);

  const scenery = useMemo(
    () =>
      resolveScenery(
        AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value.scenery : null,
      ),
    [preferencesResult],
  );
  const isReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;

  // Writes read through a ref so a same-tick burst of first-sight assignments
  // (e.g. restoring a back stack) cannot drop each other while the optimistic
  // preference patch is still settling.
  const sceneryRef = useRef(scenery);
  useEffect(() => {
    sceneryRef.current = scenery;
  }, [scenery]);

  const photoSetId = scenery.photoSetId;
  const cachedSeeds = peekSeedPhotos(photoSetId);
  // Extra sets import lazily. Serve the in-memory cache on the same tick as a
  // set change (world-scenery is always cached; extras after first load). On
  // the first switch to an uncached extra, keep the previous pool so the
  // wallpaper never drops to [] while the JSON import resolves.
  const [heldSeeds, setHeldSeeds] = useState(() =>
    cachedSeeds.length > 0 ? cachedSeeds : peekSeedPhotos(DEFAULT_PHOTO_SET_ID),
  );
  useEffect(() => {
    let cancelled = false;
    void loadSeedPhotos(photoSetId).then((photos) => {
      if (!cancelled && photos.length > 0) {
        setHeldSeeds(photos);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [photoSetId]);
  const photos = cachedSeeds.length > 0 ? cachedSeeds : heldSeeds;
  const pool = useMemo(() => getSceneryPool([], photos), [photos]);

  const photoForThreadKey = useCallback(
    (threadKey: string): SceneryPhoto | null => {
      const assignment = scenery.assignments[threadKey];
      const boundSet = assignment?.photoSetId ?? DEFAULT_PHOTO_SET_ID;
      if (assignment !== undefined && boundSet === scenery.photoSetId) {
        const photo = pool.find((entry) => entry.id === assignment.photoId);
        if (photo !== undefined) {
          return photo;
        }
      }
      return fallbackPhoto(pool, threadKey);
    },
    [pool, scenery.assignments, scenery.photoSetId],
  );

  const dailyPhoto = useMemo(() => dailyFeatured(pool, dailySeed()), [pool]);

  const persistScenery = useCallback(
    (patch: Partial<MobileSceneryPreferences>) => {
      const current = sceneryRef.current;
      const next = resolveScenery({
        enabled: current.enabled,
        blur: current.blur,
        translucency: current.translucency,
        photoSetId: current.photoSetId,
        assignments: current.assignments,
        ...patch,
      });
      sceneryRef.current = next;
      savePreferences({ scenery: next });
    },
    [savePreferences],
  );

  const ensureThreadAssignment = useCallback(
    (threadKey: string) => {
      const current = sceneryRef.current;
      const livePool = sceneryPoolForSet(current.photoSetId);
      if (livePool.length === 0) {
        return;
      }
      const existing = current.assignments[threadKey];
      const boundSet = existing?.photoSetId ?? DEFAULT_PHOTO_SET_ID;
      if (
        existing !== undefined &&
        boundSet === current.photoSetId &&
        livePool.some((entry) => entry.id === existing.photoId)
      ) {
        return;
      }
      const pick = pickScenery(livePool, current.assignments);
      if (pick === null) {
        return;
      }
      persistScenery({
        assignments: capAssignments({
          ...current.assignments,
          [threadKey]: {
            photoId: pick.id,
            name: pick.name,
            assignedAt: Date.now(),
            photoSetId: current.photoSetId,
          },
        }),
      });
    },
    [persistScenery, pool],
  );

  const setEnabled = useCallback(
    (value: boolean) => persistScenery({ enabled: value }),
    [persistScenery],
  );
  const setBlur = useCallback(
    (value: number) => persistScenery({ blur: clampBlur(value) }),
    [persistScenery],
  );
  const setTranslucency = useCallback(
    (value: number) => persistScenery({ translucency: clampTranslucency(value) }),
    [persistScenery],
  );
  const setPhotoSetId = useCallback(
    (value: PhotoSetId) => {
      const next = parsePhotoSetId(value);
      if (next === sceneryRef.current.photoSetId) {
        return;
      }
      persistScenery({ photoSetId: next });
    },
    [persistScenery],
  );

  const value = useMemo(
    (): SceneryContextValue => ({
      ...scenery,
      isReady,
      photoForThreadKey,
      dailyPhoto,
      ensureThreadAssignment,
      setEnabled,
      setBlur,
      setTranslucency,
      setPhotoSetId,
    }),
    [
      scenery,
      isReady,
      photoForThreadKey,
      dailyPhoto,
      ensureThreadAssignment,
      setEnabled,
      setBlur,
      setTranslucency,
      setPhotoSetId,
    ],
  );

  return <SceneryContext.Provider value={value}>{props.children}</SceneryContext.Provider>;
}

export function useScenery(): SceneryContextValue {
  const context = use(SceneryContext);
  if (!context) {
    throw new Error("useScenery must be used within SceneryProvider");
  }
  return context;
}

function useSceneryPhotosAllowed(): boolean {
  const { themeId } = useAppearancePreferences();
  return !isBoringMobileTheme(themeId);
}

/**
 * True when list chrome should go translucent over the scenery photo.
 * Reduce Transparency, Boring mode, and a disabled engine keep the opaque plates.
 */
export function useSceneryChromeActive(): boolean {
  const context = use(SceneryContext);
  const reduceTransparency = useReduceTransparency();
  const photosAllowed = useSceneryPhotosAllowed();
  return context !== null && context.enabled && photosAllowed && !reduceTransparency;
}

/** Photo bound to a thread key, assigning one on first sight. */
export function useThreadSceneryPhoto(threadKey: string): SceneryPhoto | null {
  const { enabled, ensureThreadAssignment, photoForThreadKey } = useScenery();
  const photosAllowed = useSceneryPhotosAllowed();
  const active = enabled && photosAllowed;
  useEffect(() => {
    if (active) {
      ensureThreadAssignment(threadKey);
    }
  }, [active, ensureThreadAssignment, threadKey]);
  return active ? photoForThreadKey(threadKey) : null;
}

/** Today's featured photo for the no-thread home screen. */
export function useDailySceneryPhoto(): SceneryPhoto | null {
  const { enabled, dailyPhoto } = useScenery();
  const photosAllowed = useSceneryPhotosAllowed();
  return enabled && photosAllowed ? dailyPhoto : null;
}
