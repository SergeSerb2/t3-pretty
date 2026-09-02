import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

interface ProjectTransferState {
  readonly threadRef: ScopedThreadRef | null;
  readonly inProgress: boolean;
  readonly open: (threadRef: ScopedThreadRef) => void;
  readonly close: () => void;
  readonly setInProgress: (inProgress: boolean) => void;
}

export const useProjectTransferStore = create<ProjectTransferState>()((set) => ({
  threadRef: null,
  inProgress: false,
  open: (threadRef) => set((state) => (state.inProgress ? {} : { threadRef, inProgress: false })),
  close: () => set({ threadRef: null, inProgress: false }),
  setInProgress: (inProgress) => set({ inProgress }),
}));

export function openProjectTransferDialog(threadRef: ScopedThreadRef): void {
  useProjectTransferStore.getState().open(threadRef);
}
