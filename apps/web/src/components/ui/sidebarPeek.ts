import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

export const SIDEBAR_PEEK_OPEN_DELAY_MS = 120;
export const SIDEBAR_PEEK_CLOSE_DELAY_MS = 240;
/** Width, label, and pane motion share this duration so a reverse hover can interrupt mid-flight. */
export const SIDEBAR_PEEK_ANIMATION_MS = 280;
export const SIDEBAR_PEEK_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

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
  if (typeof Node === "undefined") return false;
  return (
    relatedTarget instanceof Node &&
    currentTarget instanceof Node &&
    currentTarget.contains(relatedTarget)
  );
}

/**
 * Native macOS traffic lights are not DOM. They occupy the top-left of the
 * titlebar (the desktop inset is ~90px inside the 52px bar). Crossing onto
 * them looks like a pointer leave with no related target.
 */
export const SIDEBAR_PEEK_NATIVE_CHROME_WIDTH_PX = 100;
export const SIDEBAR_PEEK_NATIVE_CHROME_HEIGHT_PX = 56;

export interface SidebarPeekPoint {
  readonly x: number;
  readonly y: number;
}

export interface SidebarPeekRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type SidebarPeekLeaveAction = "ignore" | "hold" | "close";

const SIDEBAR_PEEK_SURFACE_SELECTOR = "[data-slot='sidebar-container'], [data-sidebar-control]";

export function pointerInsideSidebarPeekRect(
  pointer: SidebarPeekPoint,
  rect: SidebarPeekRect,
): boolean {
  return (
    pointer.x >= rect.left &&
    pointer.x <= rect.right &&
    pointer.y >= rect.top &&
    pointer.y <= rect.bottom
  );
}

export function pointerInSidebarNativeChrome(
  pointer: SidebarPeekPoint,
  anchor: { readonly left: number; readonly top: number },
): boolean {
  return pointerInsideSidebarPeekRect(pointer, {
    left: anchor.left,
    top: anchor.top,
    right: anchor.left + SIDEBAR_PEEK_NATIVE_CHROME_WIDTH_PX,
    bottom: anchor.top + SIDEBAR_PEEK_NATIVE_CHROME_HEIGHT_PX,
  });
}

export function isSidebarPeekSurfaceTarget(target: EventTarget | null): boolean {
  const element =
    typeof Element !== "undefined" && target instanceof Element
      ? target
      : typeof Node !== "undefined" && target instanceof Node
        ? target.parentElement
        : null;
  if (!element || typeof element.closest !== "function") return false;
  return element.closest(SIDEBAR_PEEK_SURFACE_SELECTOR) !== null;
}

export function resolveSidebarPeekLeave(input: {
  readonly currentTarget: EventTarget | null;
  readonly relatedTarget: EventTarget | null;
  readonly pointer: SidebarPeekPoint | null;
  readonly anchor: { readonly left: number; readonly top: number } | null;
}): SidebarPeekLeaveAction {
  if (shouldIgnoreSidebarPeekLeave(input.currentTarget, input.relatedTarget)) return "ignore";
  if (isSidebarPeekSurfaceTarget(input.relatedTarget)) return "ignore";
  // A swallowed hit (native traffic lights, or a drag region over them) still
  // reports the pointer inside the chrome pad. Hold the flyout so the buttons
  // stay visible; a later move outside the sidebar closes it.
  if (
    input.relatedTarget == null &&
    input.pointer &&
    input.anchor &&
    pointerInSidebarNativeChrome(input.pointer, input.anchor)
  ) {
    return "hold";
  }
  return "close";
}

function sidebarPeekRectOf(element: HTMLElement): SidebarPeekRect | null {
  const rect = element.getBoundingClientRect();
  if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) return null;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function readSidebarPeekHitRects(container: HTMLElement): readonly SidebarPeekRect[] {
  const rects: SidebarPeekRect[] = [];
  const containerRect = sidebarPeekRectOf(container);
  if (containerRect) rects.push(containerRect);
  const bridge = container.querySelector("[data-sidebar-peek-hover-bridge]");
  if (bridge instanceof HTMLElement) {
    const bridgeRect = sidebarPeekRectOf(bridge);
    if (bridgeRect) rects.push(bridgeRect);
  }
  const control = document.querySelector("[data-sidebar-control]");
  if (control instanceof HTMLElement) {
    const controlRect = sidebarPeekRectOf(control);
    if (controlRect) rects.push(controlRect);
  }
  return rects;
}

function findSidebarPeekContainer(target: EventTarget | null): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (typeof Element !== "undefined" && target instanceof Element) {
    const closest = target.closest("[data-slot='sidebar-container']");
    if (closest instanceof HTMLElement) return closest;
  }
  const found = document.querySelector("[data-slot='sidebar-container']");
  return found instanceof HTMLElement ? found : null;
}

export function useSidebarPeekPointerBinding(onEnter: () => void, onLeave: () => void) {
  const onEnterRef = useRef(onEnter);
  const onLeaveRef = useRef(onLeave);
  const stopWatchRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onEnterRef.current = onEnter;
    onLeaveRef.current = onLeave;
  }, [onEnter, onLeave]);

  const stopWatch = useCallback(() => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
  }, []);

  useEffect(() => stopWatch, [stopWatch]);

  const onPointerEnter = useCallback(() => {
    stopWatch();
    onEnterRef.current();
  }, [stopWatch]);

  const onPointerLeave = useCallback(
    (event: ReactPointerEvent<Element>) => {
      const container = findSidebarPeekContainer(event.currentTarget);
      const anchorRect = container ? sidebarPeekRectOf(container) : null;
      const action = resolveSidebarPeekLeave({
        currentTarget: event.currentTarget,
        relatedTarget: event.relatedTarget,
        pointer: { x: event.clientX, y: event.clientY },
        anchor: anchorRect ? { left: anchorRect.left, top: anchorRect.top } : null,
      });
      if (action === "ignore") return;
      if (action === "hold" && container) {
        stopWatch();
        const onMove = (move: PointerEvent) => {
          const overSurface = isSidebarPeekSurfaceTarget(move.target);
          const inside = readSidebarPeekHitRects(container).some((rect) =>
            pointerInsideSidebarPeekRect({ x: move.clientX, y: move.clientY }, rect),
          );
          if (overSurface || inside) return;
          stopWatch();
          onLeaveRef.current();
        };
        window.addEventListener("pointermove", onMove);
        stopWatchRef.current = () => window.removeEventListener("pointermove", onMove);
        return;
      }
      stopWatch();
      onLeaveRef.current();
    },
    [stopWatch],
  );

  return { onPointerEnter, onPointerLeave };
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
