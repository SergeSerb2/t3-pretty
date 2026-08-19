/**
 * The appearance actually painted on <html>, which World Scenery ink can
 * flip independently of the stored light/dark preference. Syntax highlighting
 * and other token colors must follow this, not useTheme().resolvedTheme —
 * otherwise a light plate can carry a dark highlighter (white tokens).
 */
import { useSyncExternalStore } from "react";

export type PaintedAppearance = "light" | "dark";

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function readPaintedAppearance(root: HTMLElement): PaintedAppearance {
  return root.classList.contains("dark") ? "dark" : "light";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (observer === null && typeof document !== "undefined") {
    observer = new MutationObserver(() => {
      for (const entry of listeners) entry();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
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

export function paintedAppearanceFromDocument(): PaintedAppearance {
  if (typeof document === "undefined") return "light";
  return readPaintedAppearance(document.documentElement);
}

export function usePaintedAppearance(): PaintedAppearance {
  // The blocking theme script paints <html> before React boots. Both snapshots
  // must read that class — a hardcoded "light" hydrates the wrong Pierre theme
  // when the plate is already dark.
  return useSyncExternalStore(
    subscribe,
    paintedAppearanceFromDocument,
    paintedAppearanceFromDocument,
  );
}
