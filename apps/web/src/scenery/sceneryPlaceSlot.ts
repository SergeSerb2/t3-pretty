/**
 * The composer cluster owns a slot for the place name + Unsplash credit.
 * Arrival and credit render from the scenery chunk and bind here so ChatView
 * does not import the photo engine.
 */

const listeners = new Set<() => void>();
let slotElement: HTMLElement | null = null;

export function bindSceneryPlaceSlot(element: HTMLElement | null): void {
  slotElement = element;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeSceneryPlaceSlot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSceneryPlaceSlot(): HTMLElement | null {
  return slotElement;
}
