/**
 * The live scenery experience while the World Scenery theme is active. Lazy
 * chunk (see SceneryHost): everything heavy — the seed pool, the store, the
 * layer CSS — enters here. Keys everything off the URL-derived thread key, so
 * a brand-new thread gets its random photo the moment its route appears and
 * keeps it across the draft→server promotion.
 *
 * The thread→photo binding is server-synced (thread.scenery.assign) so every
 * device of one environment renders the same photo. The server keeps the
 * first assignment it sees; the local assignment map only bridges drafts
 * (no server thread yet) and pre-scenery servers.
 */
import { useAtomValue } from "@effect/atom-react";
import { connectionProjectionPhase } from "@t3tools/client-runtime/connection";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Atom } from "effect/unstable/reactivity";

import { getMediaQueryEntry } from "../hooks/useMediaQuery";
import { environmentCatalog } from "../connection/catalog";
import { readEnvironmentSupportsScenery } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentThreadShells, threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { layerStack } from "./glass";
import { usePhotoSetStore } from "./photoSetStore";
import { pickInkVariant, type InkDecisionInput } from "./sceneryInk";
import { loadSeedPhotos, peekSeedPhotos } from "./scenerySeeds";
import { SceneryArrival } from "./SceneryArrival";
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
import { useInkOverride } from "./useInkOverride";
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
  const inkMode = useSceneryStore((state) => state.inkMode);
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

  useEffect(() => {
    if (!threadKey) {
      return;
    }
    if (serverScenery && pool.some((entry) => entry.id === serverScenery.photoId)) {
      return;
    }
    // Local first: the photo shows this tick and covers drafts (no server
    // thread yet) and pre-scenery servers. Also used when the server photo
    // belongs to a different photo set than the one on screen.
    ensureAssignment(threadKey);
    if (
      serverScenery ||
      !threadRef ||
      !serverThreadKnown ||
      !connectionReady ||
      !readEnvironmentSupportsScenery(threadRef.environmentId)
    ) {
      return;
    }
    // Upload the local pick so the other devices converge on it. The server
    // keeps the first assignment it sees (write-once), so a raced device
    // adopts the winner when the shell stream lands. connectionReady is a
    // dependency, so a dispatch lost to a dropped socket retries on reconnect.
    const state = useSceneryStore.getState();
    const assignment = state.assignments[threadKey];
    // Resolve exactly what the render path shows for this assignment —
    // including the deterministic fallback when the saved photo left the
    // pool — so the photo on screen is the one other devices converge on.
    const poolSnapshot = getSceneryPool(
      state.fetchedBySet[usePhotoSetStore.getState().photoSetId] ?? EMPTY_FETCHED_PHOTOS,
      peekSeedPhotos(usePhotoSetStore.getState().photoSetId),
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
      input: { threadId: threadRef.threadId, scenery: photoToAssignmentPayload(photo) },
    });
  }, [
    threadKey,
    threadRef,
    serverScenery,
    serverThreadKnown,
    connectionReady,
    ensureAssignment,
    assignScenery,
    pool,
  ]);

  const assignment = threadKey ? (assignments[threadKey] ?? null) : null;
  const photo = useMemo(() => {
    if (threadKey) {
      // Server binding wins when that photo still belongs to the active set.
      // A Night Cities session should not keep painting a World Scenery
      // assignment just because the server wrote it first.
      if (serverScenery) {
        const bound = photoFromAssignment(serverScenery);
        if (pool.some((entry) => entry.id === bound.id)) {
          return bound;
        }
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
  }, [threadKey, serverScenery, assignment, pool]);

  const seed = threadKey ?? dailySeed();

  useEffect(() => {
    if (!photo) {
      return;
    }
    void preloadWallpaper(wallpaperURL(photo, blur));
  }, [photo, blur]);

  // Ink follows the photo that is actually on screen. Using the incoming
  // assignment would flip chrome/wash while the outgoing wallpaper is still
  // dissolving (SceneryLayer only commits the new photo once decoded). Until
  // the first photo has displayed, the assignment is the right source so the
  // opening gradient already has matching ink.
  const [displayedTone, setDisplayedTone] = useState<{
    readonly averageColorHex: string | null;
    readonly seed: string;
  } | null>(null);
  const [displayedPhotoId, setDisplayedPhotoId] = useState<string | null>(null);
  const pendingToneRef = useRef<{
    readonly averageColorHex: string | null;
    readonly seed: string;
  } | null>(null);

  const incomingInk: Omit<InkDecisionInput, "baseAppearance"> = {
    averageColorHex: photo?.averageColorHex ?? null,
    seed,
    translucency,
    blur,
    inkMode,
  };
  const delayedInk: Omit<InkDecisionInput, "baseAppearance"> = {
    averageColorHex:
      displayedTone !== null ? displayedTone.averageColorHex : incomingInk.averageColorHex,
    seed: displayedTone !== null ? displayedTone.seed : incomingInk.seed,
    translucency,
    blur,
    inkMode,
  };

  // Per-thread ink: repaint the palette in whichever variant reads best over
  // this thread's photo. Off under reduced transparency — the photo is not
  // shown, so the appearance preference should win unchallenged.
  const { base: inkBase } = useInkOverride(reducedTransparency ? null : delayedInk);
  const delayedVariant = pickInkVariant({ ...delayedInk, baseAppearance: inkBase });
  const incomingVariant = pickInkVariant({ ...incomingInk, baseAppearance: inkBase });
  const appearanceCrossfade = photo !== null && incomingVariant !== delayedVariant;

  // Publish the layer alphas the CSS reads, plus the positive activation
  // attribute the transparent-surface rules are gated on. A positive gate —
  // rather than :not([data-scenery-reduced]) — means the first painted frame
  // (before this effect) keeps the stock opaque surfaces, which is exactly
  // right under prefers-reduced-transparency. Layout so a view-transition
  // photo commit captures the matching wash in the same frame as the ink.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (reducedTransparency) {
      root.removeAttribute("data-scenery-on");
      return;
    }
    const darkStack = layerStack(translucency, "dark", increasedContrast);
    const lightStack = layerStack(translucency, "light", increasedContrast);
    const activeStack = delayedVariant === "dark" ? darkStack : lightStack;
    root.style.setProperty("--scenery-wash-dark-alpha", String(darkStack.washAlpha));
    root.style.setProperty("--scenery-wash-light-alpha", String(lightStack.washAlpha));
    root.style.setProperty("--scenery-wash-dark-opacity", delayedVariant === "dark" ? "1" : "0");
    root.style.setProperty("--scenery-wash-light-opacity", delayedVariant === "light" ? "1" : "0");
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
  }, [translucency, delayedVariant, increasedContrast, reducedTransparency]);

  if (reducedTransparency) {
    return null;
  }

  const photoReady = photo !== null && displayedPhotoId === photo.id;

  return (
    <>
      <SceneryArrival
        photo={photo}
        threadKey={threadKey}
        photoReady={photoReady}
        onPhaseChange={(phase) => {
          if (phase !== "reveal" && phase !== "settled") {
            return;
          }
          const pending = pendingToneRef.current;
          if (pending) {
            pendingToneRef.current = null;
            setDisplayedTone(pending);
          }
        }}
      />
      <SceneryLayer
        photo={photo}
        seed={seed}
        blur={blur}
        appearanceCrossfade={appearanceCrossfade}
        onPhotoDisplayed={(displayed) => {
          registerDisplayed(displayed);
          setDisplayedPhotoId(displayed.id);
          const tone = {
            averageColorHex: displayed.averageColorHex,
            seed,
          };
          if (document.documentElement.dataset.sceneryArrival === "fog") {
            pendingToneRef.current = tone;
            return;
          }
          pendingToneRef.current = null;
          setDisplayedTone(tone);
        }}
      />
      <SceneryPlaceCredit photo={photo} />
    </>
  );
}
