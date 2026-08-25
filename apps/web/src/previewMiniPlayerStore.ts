import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export interface PreviewMiniPlayerPosition {
  readonly x: number;
  readonly y: number;
}

export interface PreviewMiniPlayerSize {
  readonly width: number;
  readonly height: number;
}

export interface PreviewMiniPlayerState {
  readonly tabId: string;
  readonly position: PreviewMiniPlayerPosition | null;
  readonly size: PreviewMiniPlayerSize | null;
}

interface PreviewMiniPlayerStoreState {
  readonly byThreadKey: Record<string, PreviewMiniPlayerState>;
  /** Tabs whose floating player the user explicitly closed; automation must not reopen them. */
  readonly dismissedTabIdsByThreadKey: Record<string, readonly string[]>;
  /** Show the player. Does not clear dismissal; explicit reopen paths call undismiss first. */
  readonly open: (ref: ScopedThreadRef, tabId: string) => void;
  readonly close: (ref: ScopedThreadRef) => void;
  readonly dismiss: (ref: ScopedThreadRef, tabId: string) => void;
  readonly undismiss: (ref: ScopedThreadRef, tabId: string) => void;
  readonly move: (ref: ScopedThreadRef, tabId: string, position: PreviewMiniPlayerPosition) => void;
  readonly resize: (ref: ScopedThreadRef, tabId: string, size: PreviewMiniPlayerSize) => void;
  readonly removeThread: (ref: ScopedThreadRef) => void;
}

function withoutDismissedTab(
  dismissedTabIdsByThreadKey: Record<string, readonly string[]>,
  threadKey: string,
  tabId: string,
): Record<string, readonly string[]> {
  const dismissed = dismissedTabIdsByThreadKey[threadKey];
  if (!dismissed?.includes(tabId)) return dismissedTabIdsByThreadKey;
  const remaining = dismissed.filter((id) => id !== tabId);
  if (remaining.length === 0) {
    const { [threadKey]: _cleared, ...rest } = dismissedTabIdsByThreadKey;
    return rest;
  }
  return { ...dismissedTabIdsByThreadKey, [threadKey]: remaining };
}

export const usePreviewMiniPlayerStore = create<PreviewMiniPlayerStoreState>()((set) => ({
  byThreadKey: {},
  dismissedTabIdsByThreadKey: {},
  open: (ref, tabId) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      if (current?.tabId === tabId) return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: {
            tabId,
            position: current?.position ?? null,
            size: current?.size ?? null,
          },
        },
      };
    }),
  dismiss: (ref, tabId) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      const dismissed = state.dismissedTabIdsByThreadKey[threadKey] ?? [];
      const alreadyDismissed = dismissed.includes(tabId);
      if (alreadyDismissed && current?.tabId !== tabId) return state;
      const { [threadKey]: _closed, ...restByThreadKey } = state.byThreadKey;
      return {
        byThreadKey: current?.tabId === tabId ? restByThreadKey : state.byThreadKey,
        dismissedTabIdsByThreadKey: alreadyDismissed
          ? state.dismissedTabIdsByThreadKey
          : { ...state.dismissedTabIdsByThreadKey, [threadKey]: [...dismissed, tabId] },
      };
    }),
  undismiss: (ref, tabId) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const dismissedTabIdsByThreadKey = withoutDismissedTab(
        state.dismissedTabIdsByThreadKey,
        threadKey,
        tabId,
      );
      if (dismissedTabIdsByThreadKey === state.dismissedTabIdsByThreadKey) return state;
      return { dismissedTabIdsByThreadKey };
    }),
  close: (ref) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      if (!(threadKey in state.byThreadKey)) return state;
      const { [threadKey]: _closed, ...byThreadKey } = state.byThreadKey;
      return { byThreadKey };
    }),
  move: (ref, tabId, position) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      if (!current || current.tabId !== tabId) return state;
      if (current.position?.x === position.x && current.position.y === position.y) return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: { ...current, position },
        },
      };
    }),
  resize: (ref, tabId, size) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      if (!current || current.tabId !== tabId) return state;
      if (current.size?.width === size.width && current.size.height === size.height) return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: { ...current, size },
        },
      };
    }),
  removeThread: (ref) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      if (!(threadKey in state.byThreadKey) && !(threadKey in state.dismissedTabIdsByThreadKey)) {
        return state;
      }
      const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
      const { [threadKey]: _dismissed, ...dismissedTabIdsByThreadKey } =
        state.dismissedTabIdsByThreadKey;
      return { byThreadKey, dismissedTabIdsByThreadKey };
    }),
}));

export function selectThreadPreviewMiniPlayer(
  byThreadKey: Record<string, PreviewMiniPlayerState>,
  ref: ScopedThreadRef | null | undefined,
): PreviewMiniPlayerState | null {
  if (!ref) return null;
  return byThreadKey[scopedThreadKey(ref)] ?? null;
}
