import { useCallback, useEffect, useRef, useState } from "react";

export const SIDEBAR_PEEK_OPEN_DELAY_MS = 160;
export const SIDEBAR_PEEK_CLOSE_DELAY_MS = 240;

export type SidebarPeekEvent = "pointer-enter" | "pointer-leave" | "peek-now" | "hide-now";

export function resolveSidebarPeekIntent(
  peeking: boolean,
  event: SidebarPeekEvent,
): { peeking: boolean; delayMs: number } {
  switch (event) {
    case "pointer-enter":
      return peeking
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

export function useSidebarPeek(enabled: boolean) {
  const [peeking, setPeeking] = useState(false);
  const timersRef = useRef({ open: 0, close: 0 });

  const clearTimers = useCallback(() => {
    window.clearTimeout(timersRef.current.open);
    window.clearTimeout(timersRef.current.close);
    timersRef.current.open = 0;
    timersRef.current.close = 0;
  }, []);

  const applyIntent = useCallback(
    (event: SidebarPeekEvent) => {
      if (!enabled && event !== "hide-now") return;
      const intent = resolveSidebarPeekIntent(peeking, event);
      clearTimers();
      if (intent.delayMs === 0) {
        setPeeking(intent.peeking);
        return;
      }
      const timer = window.setTimeout(() => setPeeking(intent.peeking), intent.delayMs);
      if (intent.peeking) timersRef.current.open = timer;
      else timersRef.current.close = timer;
    },
    [clearTimers, enabled, peeking],
  );

  const peekNow = useCallback(() => applyIntent("peek-now"), [applyIntent]);
  const hideNow = useCallback(() => applyIntent("hide-now"), [applyIntent]);
  const onPeekPointerEnter = useCallback(() => applyIntent("pointer-enter"), [applyIntent]);
  const onPeekPointerLeave = useCallback(() => applyIntent("pointer-leave"), [applyIntent]);

  useEffect(() => {
    if (!enabled) hideNow();
  }, [enabled, hideNow]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { peeking, peekNow, hideNow, onPeekPointerEnter, onPeekPointerLeave };
}
