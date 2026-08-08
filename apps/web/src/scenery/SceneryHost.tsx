/**
 * Mounts the World Scenery experience when the "World Scenery" theme is the
 * active palette. Lives at the app root (outside the thread routes) and keys
 * everything off the URL-derived thread key, so a brand-new thread gets its
 * random photo the moment its route appears and keeps it across the
 * draft→server promotion.
 *
 * Theme activation is observed through `data-theme-id` on <html> — the same
 * signal the palette CSS keys off — so this module needs no hooks into the
 * theme system's internals beyond installing its palette.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { layerStack } from "./glass";
import { SceneryLayer } from "./SceneryLayer";
import {
  dailyFeatured,
  dailySeed,
  fallbackPhoto,
  getSceneryPool,
  useSceneryStore,
} from "./sceneryStore";
import { useActiveThreadKey } from "./useActiveThreadKey";
import { ensureWorldSceneryThemeInstalled, WORLD_SCENERY_THEME_ID } from "./worldSceneryTheme";
import "./scenery.css";

function subscribeToHtmlAttributes(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-id", "class"],
  });
  return () => observer.disconnect();
}

function useSceneryThemeActive(): boolean {
  return useSyncExternalStore(
    subscribeToHtmlAttributes,
    () => document.documentElement.dataset.themeId === WORLD_SCENERY_THEME_ID,
    () => false,
  );
}

function useIsDarkAppearance(): boolean {
  return useSyncExternalStore(
    subscribeToHtmlAttributes,
    () => document.documentElement.classList.contains("dark"),
    () => true,
  );
}

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

export function SceneryHost() {
  const active = useSceneryThemeActive();

  useEffect(() => {
    ensureWorldSceneryThemeInstalled();
  }, []);

  if (!active) {
    return null;
  }
  return <ActiveScenery />;
}

function ActiveScenery() {
  const isDark = useIsDarkAppearance();
  const increasedContrast = useIncreasedContrast();
  const reducedTransparency = useReducedTransparency();
  const threadKey = useActiveThreadKey();
  const assignments = useSceneryStore((state) => state.assignments);
  const fetchedPhotos = useSceneryStore((state) => state.fetchedPhotos);
  const translucency = useSceneryStore((state) => state.translucency);
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

  // Publish the layer alphas the CSS reads. Kept on <html> so the values are
  // available to every scenery selector without prop drilling.
  useEffect(() => {
    const root = document.documentElement;
    const stack = layerStack(translucency, isDark ? "dark" : "light", increasedContrast);
    root.style.setProperty("--scenery-wash-alpha", String(stack.washAlpha));
    root.style.setProperty("--scenery-photo-opacity", String(stack.photoOpacity));
    root.style.setProperty("--scenery-edge-top-alpha", String(stack.edgeTopAlpha));
    root.style.setProperty("--scenery-edge-bottom-alpha", String(stack.edgeBottomAlpha));
    root.style.setProperty("--scenery-wash-channel", isDark ? "0 0 0" : "255 255 255");
    if (reducedTransparency) {
      root.setAttribute("data-scenery-reduced", "");
    } else {
      root.removeAttribute("data-scenery-reduced");
    }
    return () => {
      root.style.removeProperty("--scenery-wash-alpha");
      root.style.removeProperty("--scenery-photo-opacity");
      root.style.removeProperty("--scenery-edge-top-alpha");
      root.style.removeProperty("--scenery-edge-bottom-alpha");
      root.style.removeProperty("--scenery-wash-channel");
      root.removeAttribute("data-scenery-reduced");
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

  if (reducedTransparency) {
    return null;
  }

  return (
    <SceneryLayer
      photo={photo}
      seed={threadKey ?? dailySeed()}
      onPhotoDisplayed={registerDisplayed}
    />
  );
}
