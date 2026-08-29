import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

interface ProjectTransferState {
  readonly threadRef: ScopedThreadRef | null;
  readonly open: (threadRef: ScopedThreadRef) => void;
  readonly close: () => void;
}

export const useProjectTransferStore = create<ProjectTransferState>()((set) => ({
  threadRef: null,
  open: (threadRef) => set({ threadRef }),
  close: () => set({ threadRef: null }),
}));

export function openProjectTransferDialog(threadRef: ScopedThreadRef): void {
  useProjectTransferStore.getState().open(threadRef);
}
