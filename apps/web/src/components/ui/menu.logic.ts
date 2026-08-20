/**
 * Standalone Menu.Root never copies its FloatingTree node id into the store
 * (Base UI 1.4–1.6). Opening a nested submenu then matches `null === null`
 * in the positioner's sibling check, so the root gets `sibling-open` and
 * closes — the Copy flyout in the thread context menu vanishes with it.
 *
 * Nested SubmenuRoot is a different component, so real sibling-open there
 * (hover another item in the parent) is unaffected.
 */
export function isSpuriousRootSiblingOpen(open: boolean, reason: unknown): boolean {
  return open === false && reason === "sibling-open";
}

export function handleRootMenuOpenChange<
  D extends { readonly reason: unknown; cancel: () => void },
>(
  open: boolean,
  eventDetails: D,
  onOpenChange: ((open: boolean, eventDetails: D) => void) | undefined,
): void {
  if (isSpuriousRootSiblingOpen(open, eventDetails.reason)) {
    eventDetails.cancel();
    return;
  }
  onOpenChange?.(open, eventDetails);
}
