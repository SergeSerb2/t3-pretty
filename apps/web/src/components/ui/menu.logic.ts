const MENU_SURFACE_SELECTOR = "[data-slot='menu-popup'], [data-slot='menu-positioner']";

function elementFromEventNode(
  node: EventTarget | null | undefined,
): { closest(selector: string): Element | null } | null {
  if (node == null || typeof node !== "object") return null;
  if ("closest" in node && typeof node.closest === "function") {
    return node as { closest(selector: string): Element | null };
  }
  if (typeof Node !== "undefined" && node instanceof Node) {
    return node.parentElement;
  }
  return null;
}

function isEventInsideMenuSurface(event: Event | undefined): boolean {
  if (event === undefined) return false;
  const related = "relatedTarget" in event ? event.relatedTarget : null;
  const target =
    elementFromEventNode(event.target) ?? elementFromEventNode(related as EventTarget | null);
  return target?.closest(MENU_SURFACE_SELECTOR) != null;
}

/**
 * Standalone Menu.Root never copies its FloatingTree node id into the store
 * (Base UI 1.4–1.6). Opening a nested submenu then matches `null === null`
 * in the positioner's sibling check, so the root gets `sibling-open` and
 * closes — the Copy flyout in the thread context menu vanishes with it.
 *
 * Nested SubmenuRoot is a different component, so real sibling-open there
 * (hover another item in the parent) is unaffected. Menubar roots share a
 * tree on purpose: sibling-open is how File closes when Edit opens, and
 * those triggers live inside `[role=menubar]`.
 */
export function isSpuriousRootSiblingOpen(
  open: boolean,
  reason: unknown,
  trigger?: { closest(selector: string): Element | null } | null,
): boolean {
  if (open !== false || reason !== "sibling-open") {
    return false;
  }
  return trigger?.closest("[role='menubar']") == null;
}

/**
 * Same missing tree id makes a click or focus move into the nested popup look
 * like an outside dismiss. The item never receives the click, and the whole
 * menu unmounts.
 */
export function isSpuriousNestedMenuDismiss(
  open: boolean,
  reason: unknown,
  event?: Event,
): boolean {
  if (open !== false || (reason !== "outside-press" && reason !== "focus-out")) {
    return false;
  }
  return isEventInsideMenuSurface(event);
}

export function handleRootMenuOpenChange<
  D extends {
    readonly reason: unknown;
    cancel: () => void;
    readonly trigger?: { closest(selector: string): Element | null } | undefined;
    readonly event?: Event;
  },
>(
  open: boolean,
  eventDetails: D,
  onOpenChange: ((open: boolean, eventDetails: D) => void) | undefined,
): void {
  if (
    isSpuriousRootSiblingOpen(open, eventDetails.reason, eventDetails.trigger) ||
    isSpuriousNestedMenuDismiss(open, eventDetails.reason, eventDetails.event)
  ) {
    eventDetails.cancel();
    return;
  }
  onOpenChange?.(open, eventDetails);
}
