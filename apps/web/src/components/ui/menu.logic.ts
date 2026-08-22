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

export function handleRootMenuOpenChange<
  D extends {
    readonly reason: unknown;
    cancel: () => void;
    readonly trigger?: { closest(selector: string): Element | null } | undefined;
  },
>(
  open: boolean,
  eventDetails: D,
  onOpenChange: ((open: boolean, eventDetails: D) => void) | undefined,
): void {
  if (isSpuriousRootSiblingOpen(open, eventDetails.reason, eventDetails.trigger)) {
    eventDetails.cancel();
    return;
  }
  onOpenChange?.(open, eventDetails);
}
