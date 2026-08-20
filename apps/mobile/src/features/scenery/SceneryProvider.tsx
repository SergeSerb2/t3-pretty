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
import { createContext, use, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";

import type { MobileSceneryPreferences } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
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
  pickScenery,
  SCENERY_POOL,
  type SceneryAssignment,
  type SceneryPhoto,
} from "./sceneryLogic";

export interface ResolvedScenery {
  readonly enabled: boolean;
  readonly blur: number;
  readonly translucency: number;
  readonly assignments: Readonly<Record<string, SceneryAssignment>>;
}

function resolveScenery(raw: MobileSceneryPreferences | null | undefined): ResolvedScenery {
  return {
    enabled: raw?.enabled ?? true,
    blur: clampBlur(raw?.blur ?? DEFAULT_BLUR),
    translucency: clampTranslucency(raw?.translucency ?? DEFAULT_TRANSLUCENCY),
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

  const pool = SCENERY_POOL;

  const photoForThreadKey = useCallback(
    (threadKey: string): SceneryPhoto | null => {
      const assignment = scenery.assignments[threadKey];
      if (assignment !== undefined) {
        const photo = pool.find((entry) => entry.id === assignment.photoId);
        if (photo !== undefined) {
          return photo;
        }
      }
      return fallbackPhoto(pool, threadKey);
    },
    [pool, scenery.assignments],
  );

  const dailyPhoto = useMemo(() => dailyFeatured(pool, dailySeed()), [pool]);

  const persistScenery = useCallback(
    (patch: Partial<MobileSceneryPreferences>) => {
      const current = sceneryRef.current;
      savePreferences({
        scenery: {
          enabled: current.enabled,
          blur: current.blur,
          translucency: current.translucency,
          assignments: current.assignments,
          ...patch,
        },
      });
    },
    [savePreferences],
  );

  const ensureThreadAssignment = useCallback(
    (threadKey: string) => {
      const current = sceneryRef.current;
      if (current.assignments[threadKey] !== undefined) {
        return;
      }
      const pick = pickScenery(pool, current.assignments);
      if (pick === null) {
        return;
      }
      const assignments = capAssignments({
        ...current.assignments,
        [threadKey]: { photoId: pick.id, name: pick.name, assignedAt: Date.now() },
      });
      persistScenery({ assignments });
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

/**
 * True when list chrome should go translucent over the scenery photo.
 * Reduce Transparency and a disabled engine keep the opaque plates.
 */
export function useSceneryChromeActive(): boolean {
  const context = use(SceneryContext);
  const reduceTransparency = useReduceTransparency();
  return context !== null && context.enabled && !reduceTransparency;
}

/** Photo bound to a thread key, assigning one on first sight. */
export function useThreadSceneryPhoto(threadKey: string): SceneryPhoto | null {
  const { enabled, ensureThreadAssignment, photoForThreadKey } = useScenery();
  useEffect(() => {
    if (enabled) {
      ensureThreadAssignment(threadKey);
    }
  }, [enabled, ensureThreadAssignment, threadKey]);
  return enabled ? photoForThreadKey(threadKey) : null;
}

/** Today's featured photo for the no-thread home screen. */
export function useDailySceneryPhoto(): SceneryPhoto | null {
  const { enabled, dailyPhoto } = useScenery();
  return enabled ? dailyPhoto : null;
}
