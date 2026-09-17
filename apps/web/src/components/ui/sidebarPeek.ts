import { useCallback, useEffect, useRef, useState } from "react";

export const SIDEBAR_PEEK_OPEN_DELAY_MS = 160;
export const SIDEBAR_PEEK_CLOSE_DELAY_MS = 240;
export const SIDEBAR_PEEK_ANIMATION_MS = 220;

export type SidebarPeekEvent = "pointer-enter" | "pointer-leave" | "peek-now" | "hide-now";

export function resolveSidebarPeekIntent(
  peeking: boolean,
  event: SidebarPeekEvent,
  flyoutPresent = false,
): { peeking: boolean; delayMs: number } {
  switch (event) {
    case "pointer-enter":
      return peeking || flyoutPresent
        ? { peeking: true, delayMs: 0 }
        : { peeking: true, delayMs: SIDEBAR_PEEK_OPEN_DELAY_MS };
    case "pointer-leave":
      return { peeking: false, delayMs: SIDEBAR_PEEK_CLOSE_DELAY_MS };
    case "peek-now":
      return { peeking: true, delayMs: 0 };
    case "hide-now":
      return { peeking: false, delayMs: 0 };
  }
}

export function shouldIgnoreSidebarPeekLeave(
  currentTarget: EventTarget | null,
  relatedTarget: EventTarget | null,
): boolean {
  if (typeof Node === "undefined" || typeof Element === "undefined") return false;
  if (relatedTarget instanceof Node && currentTarget instanceof Node) {
    if (currentTarget.contains(relatedTarget)) return true;
  }
  if (!(relatedTarget instanceof Element)) return false;
  return (
    relatedTarget.closest("[data-slot='tooltip-popup'], [data-slot='tooltip-positioner']") != null
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useSidebarPeek(enabled: boolean) {
  const [peeking, setPeeking] = useState(false);
  const [present, setPresent] = useState(false);
  const timersRef = useRef({ open: 0, close: 0, exit: 0 });

  const clearTimers = useCallback(() => {
    window.clearTimeout(timersRef.current.open);
    window.clearTimeout(timersRef.current.close);
    window.clearTimeout(timersRef.current.exit);
    timersRef.current.open = 0;
    timersRef.current.close = 0;
    timersRef.current.exit = 0;
  }, []);

  const showFlyout = useCallback(() => {
    setPresent(true);
    setPeeking(true);
  }, []);

  const hideFlyout = useCallback((immediate: boolean) => {
    setPeeking(false);
    if (immediate || prefersReducedMotion()) {
      setPresent(false);
      return;
    }
    timersRef.current.exit = window.setTimeout(() => setPresent(false), SIDEBAR_PEEK_ANIMATION_MS);
  }, []);

  const applyIntent = useCallback(
    (event: SidebarPeekEvent) => {
      if (!enabled && event !== "hide-now") return;
      const intent = resolveSidebarPeekIntent(peeking, event, present);
      clearTimers();
      if (intent.peeking) {
        if (intent.delayMs === 0) showFlyout();
        else timersRef.current.open = window.setTimeout(showFlyout, intent.delayMs);
        return;
      }
      if (intent.delayMs === 0) {
        hideFlyout(true);
        return;
      }
      timersRef.current.close = window.setTimeout(() => hideFlyout(false), intent.delayMs);
    },
    [clearTimers, enabled, hideFlyout, peeking, present, showFlyout],
  );

  const peekNow = useCallback(() => applyIntent("peek-now"), [applyIntent]);
  const hideNow = useCallback(() => applyIntent("hide-now"), [applyIntent]);
  const onPeekPointerEnter = useCallback(() => applyIntent("pointer-enter"), [applyIntent]);
  const onPeekPointerLeave = useCallback(() => applyIntent("pointer-leave"), [applyIntent]);

  useEffect(() => {
    if (!enabled) hideNow();
  }, [enabled, hideNow]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return {
    peeking,
    peekFlyout: present,
    peekNow,
    hideNow,
    onPeekPointerEnter,
    onPeekPointerLeave,
  };
}
