/**
 * The appearance actually painted on <html>. The blocking theme script paints
 * it before React boots and useTheme repaints it on preference or system
 * changes, so syntax highlighting and other token colors follow this rather
 * than a render-time snapshot — otherwise a light plate can briefly carry a
 * dark highlighter (white tokens).
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
