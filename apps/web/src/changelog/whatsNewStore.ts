import { create } from "zustand";

interface WhatsNewState {
  /** True while the user has the full changelog open on demand, as opposed
      to the automatic post-update presentation. */
  readonly manuallyOpened: boolean;
  readonly openWhatsNew: () => void;
  readonly closeWhatsNew: () => void;
}

export const useWhatsNewStore = create<WhatsNewState>()((set) => ({
  manuallyOpened: false,
  openWhatsNew: () => set({ manuallyOpened: true }),
  closeWhatsNew: () => set({ manuallyOpened: false }),
}));

/** Open the full What's New changelog from anywhere (settings, palette). */
export function openWhatsNewDialog(): void {
  useWhatsNewStore.getState().openWhatsNew();
}
