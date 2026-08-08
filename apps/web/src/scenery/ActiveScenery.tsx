/**
 * The live scenery experience while the World Scenery theme is active. Lazy
 * chunk (see SceneryHost): everything heavy — the seed pool, the store, the
 * layer CSS — enters here. Keys everything off the URL-derived thread key, so
 * a brand-new thread gets its random photo the moment its route appears and
 * keeps it across the draft→server promotion.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { layerStack } from "./glass";
import { SceneryLayer } from "./SceneryLayer";
import { SceneryQuickSettings } from "./SceneryQuickSettings";
import {
  dailyFeatured,
  dailySeed,
  fallbackPhoto,
  getSceneryPool,
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
  const assignments = useSceneryStore((state) => state.assignments);
  const fetchedPhotos = useSceneryStore((state) => state.fetchedPhotos);
  const translucency = useSceneryStore((state) => state.translucency);
  const blur = useSceneryStore((state) => state.blur);
  const inkMode = useSceneryStore((state) => state.inkMode);
  const ensureAssignment = useSceneryStore((state) => state.ensureAssignment);
  const registerDisplayed = useSceneryStore((state) => state.registerDisplayed);
  const refreshPoolIfStale = useSceneryStore((state) => state.refreshPoolIfStale);

  const pool = useMemo(() => getSceneryPool(fetchedPhotos), [fetchedPhotos]);

  useEffect(() => {
    void refreshPoolIfStale();
  }, [refreshPoolIfStale]);

  useEffect(() => {
    if (threadKey) {
      ensureAssignment(threadKey);
    }
  }, [threadKey, ensureAssignment]);

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
  }, [threadKey, assignment, pool]);

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
