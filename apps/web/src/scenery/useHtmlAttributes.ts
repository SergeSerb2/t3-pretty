/**
 * One shared MutationObserver over scenery-related <html> attributes, exposed
 * as an external store so every scenery hook rides the same subscription
 * instead of installing its own observer.
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
      attributeFilter: ["data-theme-id", "data-scenery-composer", "data-scenery-arrival"],
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

export function useHtmlAttributeStore<T>(read: (root: HTMLElement) => T, serverSnapshot: T): T {
  return useSyncExternalStore(
    subscribe,
    () => read(document.documentElement),
    () => serverSnapshot,
  );
}

export function useSceneryThemeActive(): boolean {
  return useHtmlAttributeStore((root) => root.dataset.themeId === WORLD_SCENERY_THEME_ID, false);
}
