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
  // True when the pointer is still inside a peek surface. Replacing the row
  // under the cursor (a thread switch) fires a leave without the pointer
  // exiting; that must not start the close animation.
  readonly pointerOverSurface?: boolean;
}): SidebarPeekLeaveAction {
  if (shouldIgnoreSidebarPeekLeave(input.currentTarget, input.relatedTarget)) return "ignore";
  if (isSidebarPeekSurfaceTarget(input.relatedTarget)) return "ignore";
  if (input.pointerOverSurface) return "hold";
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

const SIDEBAR_PEEK_HOVER_SELECTOR = "[data-slot='sidebar-container'], [data-sidebar-control]";

export function sidebarPeekSurfaceIsHovered(): boolean {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
    return false;
  }
  const nodes = document.querySelectorAll(SIDEBAR_PEEK_HOVER_SELECTOR);
  for (const node of nodes) {
    if (node instanceof Element && node.matches(":hover")) return true;
  }
  return false;
}

export function pointerStillInsideSidebarPeek(input: {
  readonly point: SidebarPeekPoint | null;
  readonly rects: readonly SidebarPeekRect[];
  readonly hovered: boolean;
}): boolean {
  if (input.hovered) return true;
  const point = input.point;
  if (!point) return false;
  return input.rects.some((rect) => pointerInsideSidebarPeekRect(point, rect));
}

/** Keep an open flyout across a navigation only while the pointer never left. */
export function shouldRetainSidebarPeek(input: {
  readonly enabled: boolean;
  readonly suppressUntilExit: boolean;
  readonly peeking: boolean;
  readonly flyoutPresent: boolean;
  readonly hovered: boolean;
  readonly point?: SidebarPeekPoint | null;
  readonly rects?: readonly SidebarPeekRect[];
}): boolean {
  return (
    input.enabled &&
    !input.suppressUntilExit &&
    (input.peeking || input.flyoutPresent) &&
    pointerStillInsideSidebarPeek({
      point: input.point ?? null,
      rects: input.rects ?? [],
      hovered: input.hovered,
    })
  );
}

export function resolveSidebarPeekHold(input: {
  readonly peeking: boolean;
  readonly flyoutPresent: boolean;
  readonly suppressUntilExit: boolean;
}): "keep-open" | "stay-closed" {
  if (input.suppressUntilExit) return "stay-closed";
  if (input.peeking || input.flyoutPresent) return "keep-open";
  return "stay-closed";
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
  const wrapper = container.closest("[data-slot='sidebar-wrapper']");
  const control = wrapper?.querySelector("[data-sidebar-control]");
  if (control instanceof HTMLElement) {
    const controlRect = sidebarPeekRectOf(control);
    if (controlRect) rects.push(controlRect);
  }
  return rects;
}

/** Walk only the event target's ancestors. Never pick the first sidebar in the document. */
export function findSidebarPeekContainer(target: EventTarget | null): HTMLElement | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  const closest = target.closest("[data-slot='sidebar-container']");
  return closest instanceof HTMLElement ? closest : null;
}

function liveSidebarPeekContainer(container: HTMLElement | null): HTMLElement | null {
  return container?.isConnected ? container : null;
}

function findSidebarPeekContainerInWrapper(target: EventTarget | null): HTMLElement | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  const wrapper = target.closest("[data-slot='sidebar-wrapper']");
  const scoped = wrapper?.querySelector("[data-slot='sidebar-container']");
  return scoped instanceof HTMLElement ? scoped : null;
}

function findSidebarPeekContainerAtPoint(point: SidebarPeekPoint | null): HTMLElement | null {
  if (
    !point ||
    typeof document === "undefined" ||
    typeof document.elementFromPoint !== "function"
  ) {
    return null;
  }
  return findSidebarPeekContainer(document.elementFromPoint(point.x, point.y));
}

export function shouldKeepSidebarPeekCollapseSuppress(input: {
  readonly suppressUntilExit: boolean;
  readonly point: SidebarPeekPoint | null;
  readonly rects: readonly SidebarPeekRect[];
  readonly hovered: boolean;
}): boolean {
  return (
    input.suppressUntilExit &&
    pointerStillInsideSidebarPeek({
      point: input.point,
      rects: input.rects,
      hovered: input.hovered,
    })
  );
}

export function useSidebarPeekPointerBinding(
  onEnter: (event?: ReactPointerEvent<Element>) => void,
  onLeave: (event?: ReactPointerEvent<Element>) => void,
  onHold: () => void = () => {},
) {
  const onEnterRef = useRef(onEnter);
  const onLeaveRef = useRef(onLeave);
  const onHoldRef = useRef(onHold);
  const stopWatchRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onEnterRef.current = onEnter;
    onLeaveRef.current = onLeave;
    onHoldRef.current = onHold;
  }, [onEnter, onHold, onLeave]);

  const stopWatch = useCallback(() => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
  }, []);

  useEffect(() => stopWatch, [stopWatch]);

  const onPointerEnter = useCallback(
    (event?: ReactPointerEvent<Element>) => {
      stopWatch();
      onEnterRef.current(event);
    },
    [stopWatch],
  );

  const onPointerLeave = useCallback(
    (event: ReactPointerEvent<Element>) => {
      const container = findSidebarPeekContainer(event.currentTarget);
      const anchorRect = container ? sidebarPeekRectOf(container) : null;
      const pointer = { x: event.clientX, y: event.clientY };
      const action = resolveSidebarPeekLeave({
        currentTarget: event.currentTarget,
        relatedTarget: event.relatedTarget,
        pointer,
        anchor: anchorRect ? { left: anchorRect.left, top: anchorRect.top } : null,
        // :hover is still true on the node being left. Hold only for a peek
        // relatedTarget or a point that is still inside this rail's rects.
        pointerOverSurface: pointerStillInsideSidebarPeek({
          point: pointer,
          rects: container ? readSidebarPeekHitRects(container) : [],
          hovered: false,
        }),
      });
      if (action === "ignore" || action === "hold") {
        // The pointer is still on a peek surface. Drop a close that a replaced
        // row already scheduled, and don't start another one.
        onHoldRef.current();
      }
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
      if (action === "hold") return;
      stopWatch();
      onLeaveRef.current(event);
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
  const [suppressHoverOpen, setSuppressHoverOpen] = useState(false);
  const timersRef = useRef({ open: 0, close: 0, exit: 0 });
  const peekingRef = useRef(peeking);
  const presentRef = useRef(present);
  const suppressHoverOpenRef = useRef(false);
  const lastPointerRef = useRef<SidebarPeekPoint | null>(null);
  const lastContainerRef = useRef<HTMLElement | null>(null);
  peekingRef.current = peeking;
  presentRef.current = present;

  const rememberSidebarPeekRail = useCallback(
    (target: EventTarget | null, point: SidebarPeekPoint | null) => {
      const found =
        findSidebarPeekContainer(target) ??
        findSidebarPeekContainerInWrapper(target) ??
        findSidebarPeekContainerAtPoint(point);
      if (found) lastContainerRef.current = found;
      return liveSidebarPeekContainer(lastContainerRef.current);
    },
    [],
  );

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
      const intent = resolveSidebarPeekIntent(peekingRef.current, event, presentRef.current);
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
      timersRef.current.close = window.setTimeout(() => {
        // The leave that armed this timer can be a lie: the row under the
        // pointer was replaced, and the pointer is still on the flyout.
        if (
          !suppressHoverOpenRef.current &&
          sidebarPeekSurfaceIsHovered() &&
          (peekingRef.current || presentRef.current)
        ) {
          showFlyout();
          return;
        }
        hideFlyout(false);
      }, intent.delayMs);
    },
    [clearTimers, enabled, hideFlyout, showFlyout],
  );

  const peekNow = useCallback(() => applyIntent("peek-now"), [applyIntent]);
  const hideNow = useCallback(() => applyIntent("hide-now"), [applyIntent]);
  const onPeekPointerEnter = useCallback(
    (event?: ReactPointerEvent<Element>) => {
      if (event) {
        const point = { x: event.clientX, y: event.clientY };
        lastPointerRef.current = point;
        rememberSidebarPeekRail(event.currentTarget, point);
      }
      if (suppressHoverOpenRef.current) return;
      applyIntent("pointer-enter");
    },
    [applyIntent, rememberSidebarPeekRail],
  );
  const onPeekPointerLeave = useCallback(
    (event?: ReactPointerEvent<Element>) => {
      const pointer = event ? { x: event.clientX, y: event.clientY } : lastPointerRef.current;
      if (event) lastPointerRef.current = pointer;
      const container = rememberSidebarPeekRail(event?.currentTarget ?? null, pointer);
      // :hover stays true on the node being left, same as the bind leave
      // path. Keep the gate only while the last point is still inside this
      // rail's hit rects.
      if (
        shouldKeepSidebarPeekCollapseSuppress({
          suppressUntilExit: suppressHoverOpenRef.current,
          point: pointer,
          rects: container ? readSidebarPeekHitRects(container) : [],
          hovered: false,
        })
      ) {
        return;
      }
      suppressHoverOpenRef.current = false;
      setSuppressHoverOpen(false);
      applyIntent("pointer-leave");
    },
    [applyIntent, rememberSidebarPeekRail],
  );
  const onPeekPointerHold = useCallback(() => {
    clearTimers();
    if (
      resolveSidebarPeekHold({
        peeking: peekingRef.current,
        flyoutPresent: presentRef.current,
        suppressUntilExit: suppressHoverOpenRef.current,
      }) === "keep-open"
    ) {
      showFlyout();
    }
  }, [clearTimers, showFlyout]);
  const noteUserCollapsedSidebar = useCallback(() => {
    // The click lands on the trigger, which is itself a peek surface. Arm the
    // gate before the browser retargets that pointer onto the collapsed rail.
    suppressHoverOpenRef.current = true;
    setSuppressHoverOpen(true);
    hideNow();
  }, [hideNow]);
  const retainPeekIfHovered = useCallback(() => {
    const pointer = lastPointerRef.current;
    const container = rememberSidebarPeekRail(null, pointer);
    if (
      !shouldRetainSidebarPeek({
        enabled,
        suppressUntilExit: suppressHoverOpenRef.current,
        peeking: peekingRef.current,
        flyoutPresent: presentRef.current,
        // A row swap can leave :hover true on the replaced node. Keep the
        // flyout only when the last point is still inside this rail.
        hovered: false,
        point: pointer,
        rects: container ? readSidebarPeekHitRects(container) : [],
      })
    ) {
      return;
    }
    clearTimers();
    showFlyout();
  }, [clearTimers, enabled, rememberSidebarPeekRail, showFlyout]);

  useEffect(() => {
    if (!enabled) hideNow();
  }, [enabled, hideNow]);

  useEffect(() => {
    const remember = (event: PointerEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointerdown", remember, { passive: true });
    window.addEventListener("pointermove", remember, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", remember);
      window.removeEventListener("pointermove", remember);
    };
  }, []);

  useEffect(() => {
    if (!suppressHoverOpen) return;
    const releaseIfPointerLeft = (point: SidebarPeekPoint | null) => {
      const container =
        liveSidebarPeekContainer(lastContainerRef.current) ??
        findSidebarPeekContainerAtPoint(point);
      if (container) lastContainerRef.current = container;
      if (
        shouldKeepSidebarPeekCollapseSuppress({
          suppressUntilExit: true,
          point,
          rects: container ? readSidebarPeekHitRects(container) : [],
          // :hover stays true on the node being left. Release only when the
          // last point is outside this rail's hit rects.
          hovered: false,
        })
      ) {
        return;
      }
      suppressHoverOpenRef.current = false;
      setSuppressHoverOpen(false);
    };
    const onMove = (event: PointerEvent) => {
      const point = { x: event.clientX, y: event.clientY };
      lastPointerRef.current = point;
      releaseIfPointerLeft(point);
    };
    // The rail finishes collapsing under a stationary pointer. Judge the
    // last point against this rail, not live :hover.
    const releaseTimer = window.setTimeout(
      () => releaseIfPointerLeft(lastPointerRef.current),
      SIDEBAR_PEEK_ANIMATION_MS,
    );
    window.addEventListener("pointermove", onMove);
    return () => {
      window.clearTimeout(releaseTimer);
      window.removeEventListener("pointermove", onMove);
    };
  }, [suppressHoverOpen]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return {
    peeking,
    peekFlyout: present,
    peekNow,
    hideNow,
    noteUserCollapsedSidebar,
    retainPeekIfHovered,
    onPeekPointerEnter,
    onPeekPointerLeave,
    onPeekPointerHold,
  };
}
