import { createContext, useContext, useEffect, useRef, useState } from "react";
import { type PanelAnimationDurationMs } from "@t3tools/contracts/settings";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./hooks/useSettings";

const PanelAnimationSuppressionContext = createContext(false);

export const PanelAnimationSuppressionProvider = PanelAnimationSuppressionContext.Provider;

/**
 * Suppresses panel motion for the first painted frame of an initial route or navigation.
 * State restored by a route must be visible immediately; later user actions can animate.
 */
export function usePanelNavigationSuppression(navigationKey: string): boolean {
  const [paintedNavigationKey, setPaintedNavigationKey] = useState<string | null>(null);
  const suppressed = paintedNavigationKey !== navigationKey;

  useEffect(() => {
    if (!suppressed) return;
    let releaseFrame = 0;
    const paintFrame = window.requestAnimationFrame(() => {
      releaseFrame = window.requestAnimationFrame(() => setPaintedNavigationKey(navigationKey));
    });
    return () => {
      window.cancelAnimationFrame(paintFrame);
      window.cancelAnimationFrame(releaseFrame);
    };
  }, [navigationKey, suppressed]);

  return suppressed;
}

/** True while the current navigation's restored state paints; see usePanelNavigationSuppression. */
export function usePanelAnimationSuppressed(): boolean {
  return useContext(PanelAnimationSuppressionContext);
}

/**
 * Latches at mount whether an enter animation may play. Something a thread
 * switch or route load mounts is restored state and appears still; something
 * that mounts later appeared in front of the user.
 */
export function useMountEnterAllowed(): boolean {
  const suppressed = usePanelAnimationSuppressed();
  const [allowed] = useState(!suppressed);
  return allowed;
}

export function usePanelAnimationSettings(): {
  active: boolean;
  durationMs: PanelAnimationDurationMs;
} {
  const durationMs = useClientSettings((settings) => settings.panelAnimationDurationMs);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const suppressed = usePanelAnimationSuppressed();
  return { active: durationMs > 0 && !prefersReducedMotion && !suppressed, durationMs };
}

/**
 * Holds a newly mounted panel visually closed for two frames so its enter
 * transition starts after the mount work instead of being eaten by it: heavy
 * surfaces (diff, terminal, browser) otherwise block the main thread through
 * most of the slide, which reads as the panel snapping open. Only the slide
 * waits; the panel is open (focusable, not inert) from its first frame. A
 * panel shown without motion (restored by navigation, reduced motion) is never
 * held, and reopening one that is still closing reverses in place.
 */
export function usePanelEnterHold(open: boolean, present: boolean, animated: boolean): boolean {
  const [entered, setEntered] = useState(open && !animated);
  if (!present && entered) setEntered(false);
  if (present && open && !animated && !entered) setEntered(true);
  const holding = present && open && animated && !entered;

  useEffect(() => {
    if (!holding) return;
    // The first frame paints the closed panel after React's mount work; the
    // second gives follow-up effect renders their own frame before motion.
    let innerFrame = 0;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, [holding]);

  return holding;
}

/** Keeps closing panel content mounted until its opt-in transition ends. */
export function usePanelPresence<T>(
  open: boolean,
  value: T | null,
  animated: boolean,
  scopeKey: string | null,
  durationMs: PanelAnimationDurationMs,
): { present: boolean; value: T | null } {
  const [present, setPresent] = useState(open);
  const retainedRef = useRef<{ scopeKey: string | null; value: T | null } | null>(
    open ? { scopeKey, value } : null,
  );

  useEffect(() => {
    if (open) retainedRef.current = { scopeKey, value };
  }, [open, scopeKey, value]);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!animated) {
      setPresent(false);
      return;
    }

    const timeout = window.setTimeout(() => setPresent(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [animated, durationMs, open]);

  const retainedValue =
    retainedRef.current?.scopeKey === scopeKey ? retainedRef.current.value : null;
  const visible = open || (animated && present && retainedRef.current?.scopeKey === scopeKey);
  return { present: visible, value: open ? value : visible ? retainedValue : null };
}
