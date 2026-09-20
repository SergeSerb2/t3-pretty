import { useLayoutEffect, useRef } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";

const visitedDrafts = new Set<string>();

/** Arrive at the usable composer immediately; wallpaper loading never owns its visibility. */
export function useDraftArrival(threadKey: string | null, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // Keep the decision through StrictMode's setup/cleanup replay.
  const arrival = useRef<{ key: string; animate: boolean } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (threadKey === null || element === null) {
      arrival.current = null;
      return;
    }
    if (arrival.current?.key !== threadKey) {
      arrival.current = { key: threadKey, animate: enabled && !visitedDrafts.has(threadKey) };
      visitedDrafts.add(threadKey);
      if (visitedDrafts.size > 256) {
        const oldest = visitedDrafts.values().next().value;
        if (oldest !== undefined) visitedDrafts.delete(oldest);
      }
    }
    if (
      !enabled ||
      reducedMotion ||
      !arrival.current.animate ||
      typeof element.animate !== "function"
    ) {
      arrival.current.animate = false;
      return;
    }

    const animation = element.animate(
      [
        { opacity: 0.85, transform: "translate3d(0, 8px, 0) scale(0.985)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    // No retained fill or completion callback: navigation, send, and preference
    // changes cancel directly to the underlying, fully interactive layout.
    return () => animation.cancel();
  }, [enabled, reducedMotion, threadKey]);

  return ref;
}
