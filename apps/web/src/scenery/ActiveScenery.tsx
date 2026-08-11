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
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { readEnvironmentSupportsScenery } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentThreadShells, threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { layerStack } from "./glass";
import { SceneryLayer } from "./SceneryLayer";
import { SceneryQuickSettings } from "./SceneryQuickSettings";
import {
  dailyFeatured,
  dailySeed,
  fallbackPhoto,
  getSceneryPool,
  photoFromAssignment,
  photoToAssignmentPayload,
  useSceneryStore,
} from "./sceneryStore";
import { useActiveThreadKey } from "./useActiveThreadKey";
import { useIsDarkAppearance } from "./useHtmlAttributes";
import { useInkOverride } from "./useInkOverride";
import "./scenery.css";

function subscribeToMediaQuery(query: string) {
  return (onChange: () => void): (() => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  };
}

const subscribeContrast = subscribeToMediaQuery("(prefers-contrast: more)");
const subscribeTransparency = subscribeToMediaQuery("(prefers-reduced-transparency: reduce)");

const NULL_THREAD_SHELL_ATOM = Atom.make(null).pipe(Atom.withLabel("scenery:no-thread-shell"));

function useIncreasedContrast(): boolean {
  return useSyncExternalStore(
    subscribeContrast,
    () => window.matchMedia("(prefers-contrast: more)").matches,
    () => false,
  );
}

function useReducedTransparency(): boolean {
  return useSyncExternalStore(
    subscribeTransparency,
    () => window.matchMedia("(prefers-reduced-transparency: reduce)").matches,
    () => false,
  );
}

export default function ActiveScenery() {
  const isDark = useIsDarkAppearance();
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
  const fetchedPhotos = useSceneryStore((state) => state.fetchedPhotos);
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

  const pool = useMemo(() => getSceneryPool(fetchedPhotos), [fetchedPhotos]);

  useEffect(() => {
    void refreshPoolIfStale();
  }, [refreshPoolIfStale]);

  useEffect(() => {
    if (!threadKey || serverScenery) {
      return;
    }
    // Local first: the photo shows this tick and covers drafts (no server
    // thread yet) and pre-scenery servers.
    ensureAssignment(threadKey);
    if (
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
    const poolSnapshot = getSceneryPool(state.fetchedPhotos);
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
  ]);

  // Publish the layer alphas the CSS reads, plus the positive activation
  // attribute the transparent-surface rules are gated on. A positive gate —
  // rather than :not([data-scenery-reduced]) — means the first painted frame
  // (before this effect) keeps the stock opaque surfaces, which is exactly
  // right under prefers-reduced-transparency.
  useEffect(() => {
    const root = document.documentElement;
    if (reducedTransparency) {
      root.removeAttribute("data-scenery-on");
      return;
    }
    const stack = layerStack(translucency, isDark ? "dark" : "light", increasedContrast);
    root.style.setProperty("--scenery-wash-alpha", String(stack.washAlpha));
    root.style.setProperty("--scenery-photo-opacity", String(stack.photoOpacity));
    root.style.setProperty("--scenery-edge-top-alpha", String(stack.edgeTopAlpha));
    root.style.setProperty("--scenery-edge-bottom-alpha", String(stack.edgeBottomAlpha));
    root.style.setProperty("--scenery-wash-channel", isDark ? "0 0 0" : "255 255 255");
    root.setAttribute("data-scenery-on", "");
    return () => {
      root.style.removeProperty("--scenery-wash-alpha");
      root.style.removeProperty("--scenery-photo-opacity");
      root.style.removeProperty("--scenery-edge-top-alpha");
      root.style.removeProperty("--scenery-edge-bottom-alpha");
      root.style.removeProperty("--scenery-wash-channel");
      root.removeAttribute("data-scenery-on");
    };
  }, [translucency, isDark, increasedContrast, reducedTransparency]);

  const assignment = threadKey ? (assignments[threadKey] ?? null) : null;
  const photo = useMemo(() => {
    if (threadKey) {
      // The server-synced binding wins: every device of the environment
      // renders the same photo, even one this device's pool lacks.
      if (serverScenery) {
        return photoFromAssignment(serverScenery);
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

  // Per-thread ink: repaint the palette in whichever variant reads best over
  // this thread's photo. Off under reduced transparency — the photo is not
  // shown, so the appearance preference should win unchallenged.
  useInkOverride(
    reducedTransparency
      ? null
      : {
          averageColorHex: photo?.averageColorHex ?? null,
          seed,
          translucency,
          blur,
          inkMode,
        },
  );

  if (reducedTransparency) {
    return null;
  }

  return (
    <>
      <SceneryLayer photo={photo} seed={seed} blur={blur} onPhotoDisplayed={registerDisplayed} />
      <SceneryQuickSettings />
    </>
  );
}
