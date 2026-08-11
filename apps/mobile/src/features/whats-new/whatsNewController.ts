/**
 * Imperative bridge for opening the What's New sheet from anywhere (Settings,
 * shortcuts) — same shape as showConfirmDialog: the host registers a
 * presenter while mounted at the app root.
 */
let presentWhatsNew: (() => void) | null = null;

export function openWhatsNew(): void {
  presentWhatsNew?.();
}

export function registerWhatsNewPresenter(present: () => void): () => void {
  presentWhatsNew = present;
  return () => {
    if (presentWhatsNew === present) {
      presentWhatsNew = null;
    }
  };
}
