/**
 * The live scenery experience while the World Scenery theme is active. Lazy
 * chunk (see SceneryHost): everything heavy — the seed pool, the store, the
 * layer CSS — enters here. Keys everything off the URL-derived thread key, so
 * a brand-new thread gets its random photo the moment its route appears and
 * keeps it across the draft→server promotion.
 *
 * The thread→photo binding is server-synced (thread.scenery.assign) so every
 * device of one environment renders the same photo. The first photo for a
 * catalog wins; choosing another catalog replaces it. The local assignment
 * map only bridges drafts (no server thread yet) and pre-scenery servers.
 */
import { useAtomValue } from "@effect/atom-react";
import { connectionProjectionPhase } from "@t3tools/client-runtime/connection";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  mayPublishThreadScenery,
  serverSceneryMatchesPhotoSet,
} from "@t3tools/client-runtime/state/scenery-sync";
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Atom } from "effect/unstable/reactivity";

import { getMediaQueryEntry } from "../hooks/useMediaQuery";
import { usePaintedAppearance } from "../hooks/usePaintedAppearance";
import { environmentCatalog } from "../connection/catalog";
import { useServerConfigs } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentThreadShells, threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { layerStack } from "./glass";
import { usePhotoSetStore } from "./photoSetStore";
import { loadSeedPhotos, peekSeedPhotos } from "./scenerySeeds";
import { SceneryLayer } from "./SceneryLayer";
import { SceneryPlaceCredit } from "./SceneryPlaceCredit";
import {
  dailyFeatured,
  dailySeed,
  fallbackPhoto,
  getSceneryPool,
  photoFromAssignment,
  photoToAssignmentPayload,
  useSceneryStore,
} from "./sceneryStore";
import { preloadWallpaper } from "./sceneryWallpaper";
import { wallpaperURL } from "./unsplash";
import { useActiveThreadKey } from "./useActiveThreadKey";
import { useSyncedSceneryPhotoSet } from "./useSyncedSceneryPhotoSet";
import "./scenery.css";

const CONTRAST_QUERY = "(prefers-contrast: more)";
const TRANSPARENCY_QUERY = "(prefers-reduced-transparency: reduce)";
const EMPTY_FETCHED_PHOTOS: ReadonlyArray<import("./unsplash").SceneryPhoto> = [];

function subscribeToCachedMediaQuery(query: string) {
  return (onChange: () => void): (() => void) => {
    const entry = getMediaQueryEntry(query);
    entry.listeners.add(onChange);
    return () => {
      entry.listeners.delete(onChange);
    };
  };
}

const subscribeContrast = subscribeToCachedMediaQuery(CONTRAST_QUERY);
const subscribeTransparency = subscribeToCachedMediaQuery(TRANSPARENCY_QUERY);

const NULL_THREAD_SHELL_ATOM = Atom.make(null).pipe(Atom.withLabel("scenery:no-thread-shell"));

function useIncreasedContrast(): boolean {
  return useSyncExternalStore(
    subscribeContrast,
    () => getMediaQueryEntry(CONTRAST_QUERY).matches,
    () => false,
  );
}

function useReducedTransparency(): boolean {
  return useSyncExternalStore(
    subscribeTransparency,
    () => getMediaQueryEntry(TRANSPARENCY_QUERY).matches,
    () => false,
  );
}

export default function ActiveScenery() {
  const increasedContrast = useIncreasedContrast();
  const reducedTransparency = useReducedTransparency();
  const threadKey = useActiveThreadKey();
  const threadRef = useMemo(
    () => (threadKey ? parseScopedThreadKey(threadKey) : null),
    [threadKey],
  );
  const threadShell = useAtomValue(
    threadRef ? environmentThreadShells.threadShellAtom(threadRef) : NULL_THREAD_SHELL_ATOM,
  );
  const serverScenery = threadShell?.scenery ?? null;
  const serverThreadKnown = threadShell !== null;
  const serverConfigs = useServerConfigs();
  const supportsScenery =
    threadRef !== null &&
    serverConfigs.get(threadRef.environmentId)?.environment.capabilities.threadScenery === true;
  const sharedPhotoSetId = useSyncedSceneryPhotoSet();
  // Reactive connection state: reconnecting re-runs the assign effect below,
  // which retries a dispatch that failed while the socket was down.
  const connection = useEnvironmentQuery(
    threadRef ? environmentCatalog.stateAtom(threadRef.environmentId) : null,
  );
  const connectionReady =
    connection.data !== null && connectionProjectionPhase(connection.data) === "ready";
  const assignments = useSceneryStore((state) => state.assignments);
  const photoSetId = usePhotoSetStore((state) => state.photoSetId);
  const fetchedPhotos = useSceneryStore(
    (state) => state.fetchedBySet[photoSetId] ?? EMPTY_FETCHED_PHOTOS,
  );
  const translucency = useSceneryStore((state) => state.translucency);
  const blur = useSceneryStore((state) => state.blur);
  const ensureAssignment = useSceneryStore((state) => state.ensureAssignment);
  const registerDisplayed = useSceneryStore((state) => state.registerDisplayed);
  const refreshPoolIfStale = useSceneryStore((state) => state.refreshPoolIfStale);
  // Sync failures leave the assignment device-local (the pre-sync behavior),
  // so they never surface as user-facing errors.
  const assignScenery = useAtomCommand(threadEnvironment.assignScenery, {
    reportFailure: false,
  });

  const [seedPhotos, setSeedPhotos] = useState(() => peekSeedPhotos(photoSetId));
  useEffect(() => {
    setSeedPhotos(peekSeedPhotos(photoSetId));
    let cancelled = false;
    void loadSeedPhotos(photoSetId).then((photos) => {
      if (!cancelled) {
        setSeedPhotos(photos);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [photoSetId]);
  const pool = useMemo(
    () => getSceneryPool(fetchedPhotos, seedPhotos),
    [fetchedPhotos, seedPhotos],
  );

  useEffect(() => {
    void refreshPoolIfStale();
  }, [photoSetId, refreshPoolIfStale]);

  const serverPhoto = useMemo(() => {
    if (!serverScenery || !serverSceneryMatchesPhotoSet(serverScenery.photoSetId, photoSetId)) {
      return null;
    }
    return photoFromAssignment(serverScenery);
  }, [photoSetId, serverScenery]);

  useEffect(() => {
    if (!threadKey) {
      return;
    }
    if (serverPhoto) {
      return;
    }
    // Local first: the photo shows this tick and covers drafts (no server
    // thread yet), pre-scenery servers, and a catalog change that still
    // needs a photo from the new set.
    ensureAssignment(threadKey);
    if (!threadRef || !serverThreadKnown || !connectionReady || !supportsScenery) {
      return;
    }
    if (!mayPublishThreadScenery({ sharedPhotoSetId, localPhotoSetId: photoSetId })) {
      return;
    }
    // Upload the local pick so the other devices converge on it. The server
    // keeps the first photo for this catalog, so a raced device adopts the
    // winner when the shell stream lands. connectionReady is a dependency, so
    // a dispatch lost to a dropped socket retries on reconnect.
    const state = useSceneryStore.getState();
    const assignment = state.assignments[threadKey];
    // Resolve exactly what the render path shows for this assignment —
    // including the deterministic fallback when the saved photo left the
    // pool — so the photo on screen is the one other devices converge on.
    const activeSetId = usePhotoSetStore.getState().photoSetId;
    const poolSnapshot = getSceneryPool(
      state.fetchedBySet[activeSetId] ?? EMPTY_FETCHED_PHOTOS,
      peekSeedPhotos(activeSetId),
    );
    const photo = assignment
      ? (poolSnapshot.find((entry) => entry.id === assignment.photoId) ??
        fallbackPhoto(poolSnapshot, threadKey))
      : undefined;
    if (!photo) {
      return;
    }
    void assignScenery({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        scenery: photoToAssignmentPayload(photo, activeSetId),
      },
    });
  }, [
    threadKey,
    threadRef,
    serverPhoto,
    serverThreadKnown,
    connectionReady,
    supportsScenery,
    sharedPhotoSetId,
    photoSetId,
    ensureAssignment,
    assignScenery,
    pool,
  ]);

  const assignment = threadKey ? (assignments[threadKey] ?? null) : null;
  const photo = useMemo(() => {
    if (threadKey) {
      // The denormalized server photo renders even when this device's pool
      // never fetched it. A different catalog falls through and is replaced.
      if (serverPhoto) {
        return serverPhoto;
      }
      if (assignment) {
        return (
          pool.find((entry) => entry.id === assignment.photoId) ?? fallbackPhoto(pool, threadKey)
        );
      }
      // The random assignment lands in the next effect tick; rendering the
      // gradient for that tick avoids loading two different photos.
      return null;
    }
    return dailyFeatured(pool, dailySeed());
  }, [threadKey, serverPhoto, assignment, pool]);

  const seed = threadKey ?? dailySeed();

  useEffect(() => {
    if (!photo) {
      return;
    }
    void preloadWallpaper(wallpaperURL(photo, blur));
  }, [photo, blur]);

  // The wash follows the app appearance (Settings → Appearance → Color
  // scheme). A thread's photo never flips it: bright and dark landscapes
  // both sit behind the light or dark variant the user chose.
  const appearance = usePaintedAppearance();

  // Publish the layer alphas the CSS reads, plus the positive activation
  // attribute the transparent-surface rules are gated on. A positive gate —
  // rather than :not([data-scenery-reduced]) — means the first painted frame
  // (before this effect) keeps the stock opaque surfaces, which is exactly
  // right under prefers-reduced-transparency. Layout so the wash lands in the
  // same frame as the palette after an appearance switch.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (reducedTransparency) {
      root.removeAttribute("data-scenery-on");
      return;
    }
    const darkStack = layerStack(translucency, "dark", increasedContrast);
    const lightStack = layerStack(translucency, "light", increasedContrast);
    const activeStack = appearance === "dark" ? darkStack : lightStack;
    root.style.setProperty("--scenery-wash-dark-alpha", String(darkStack.washAlpha));
    root.style.setProperty("--scenery-wash-light-alpha", String(lightStack.washAlpha));
    root.style.setProperty("--scenery-wash-dark-opacity", appearance === "dark" ? "1" : "0");
    root.style.setProperty("--scenery-wash-light-opacity", appearance === "light" ? "1" : "0");
    root.style.setProperty("--scenery-photo-opacity", String(activeStack.photoOpacity));
    root.style.setProperty("--scenery-edge-top-alpha", String(activeStack.edgeTopAlpha));
    root.style.setProperty("--scenery-edge-bottom-alpha", String(activeStack.edgeBottomAlpha));
    root.setAttribute("data-scenery-on", "");
    return () => {
      root.style.removeProperty("--scenery-wash-dark-alpha");
      root.style.removeProperty("--scenery-wash-light-alpha");
      root.style.removeProperty("--scenery-wash-dark-opacity");
      root.style.removeProperty("--scenery-wash-light-opacity");
      root.style.removeProperty("--scenery-photo-opacity");
      root.style.removeProperty("--scenery-edge-top-alpha");
      root.style.removeProperty("--scenery-edge-bottom-alpha");
      root.removeAttribute("data-scenery-on");
    };
  }, [translucency, appearance, increasedContrast, reducedTransparency]);

  if (reducedTransparency) {
    return null;
  }

  return (
    <>
      <SceneryLayer photo={photo} seed={seed} blur={blur} onPhotoDisplayed={registerDisplayed} />
      <SceneryPlaceCredit photo={photo} />
    </>
  );
}
