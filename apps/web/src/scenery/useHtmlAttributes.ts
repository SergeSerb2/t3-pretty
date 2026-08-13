/**
 * One shared MutationObserver over <html>'s `data-theme-id`, exposed as an
 * external store so every scenery hook rides the same subscription instead
 * of installing its own observer.
 */
import { useSyncExternalStore } from "react";

import { WORLD_SCENERY_THEME_ID } from "./worldSceneryTheme";

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (observer === null && typeof document !== "undefined") {
    observer = new MutationObserver(() => {
      for (const entry of listeners) {
        entry();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme-id"],
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

export function useSceneryThemeActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.themeId === WORLD_SCENERY_THEME_ID,
    () => false,
  );
}
