import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { DevicePlatform, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveLocalStorage } from "./lib/storage";

export interface PreviewMiniPlayerPosition {
  readonly x: number;
  readonly y: number;
}

export interface PreviewMiniPlayerSize {
  readonly width: number;
  readonly height: number;
}

/** What the floating player mirrors: a browser tab or a device stream. */
export type PreviewMiniPlayerSource =
  | { readonly kind: "browser"; readonly tabId: string }
  | {
      readonly kind: "device";
      readonly hostId: string;
      readonly deviceId: string;
      readonly platform: DevicePlatform;
      readonly name: string;
    };

export interface PreviewMiniPlayerState {
  readonly source: PreviewMiniPlayerSource;
  readonly position: PreviewMiniPlayerPosition | null;
  /** Height always follows the mirrored source's aspect ratio. */
  readonly width: number | null;
}

interface PreviewMiniPlayerStoreState {
  readonly byThreadKey: Record<string, PreviewMiniPlayerState>;
  /** Tabs whose floating player the user explicitly closed; automation must not reopen them. */
  readonly dismissedTabIdsByThreadKey: Record<string, readonly string[]>;
  /** Show the player. Does not clear dismissal; explicit reopen paths call undismiss first. */
  readonly open: (ref: ScopedThreadRef, source: PreviewMiniPlayerSource) => void;
  /** Automation auto-present: never revive a browser tab the user closed. */
  readonly openIfNotDismissed: (ref: ScopedThreadRef, tabId: string) => void;
  readonly close: (ref: ScopedThreadRef) => void;
  readonly dismiss: (ref: ScopedThreadRef, tabId: string) => void;
  readonly undismiss: (ref: ScopedThreadRef, tabId: string) => void;
  /** `sourceKey` guards against a drag that outlives the source it started on. */
  readonly move: (
    ref: ScopedThreadRef,
    sourceKey: string,
    position: PreviewMiniPlayerPosition,
  ) => void;
  readonly resize: (ref: ScopedThreadRef, sourceKey: string, width: number) => void;
  readonly removeThread: (ref: ScopedThreadRef) => void;
}

export function previewMiniPlayerSourceKey(source: PreviewMiniPlayerSource): string {
  return source.kind === "browser"
    ? `browser:${source.tabId}`
    : `device:${encodeURIComponent(source.hostId)}:${encodeURIComponent(source.deviceId)}`;
}

export const browserMiniPlayerSource = (tabId: string): PreviewMiniPlayerSource => ({
  kind: "browser",
  tabId,
});

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

const PREVIEW_MINI_PLAYER_STORAGE_KEY = "t3code:preview-mini-player:v1";

function openedPlayer(
  state: Pick<PreviewMiniPlayerStoreState, "byThreadKey" | "dismissedTabIdsByThreadKey">,
  ref: ScopedThreadRef,
  source: PreviewMiniPlayerSource,
  honorDismissal: boolean,
): Pick<PreviewMiniPlayerStoreState, "byThreadKey"> | typeof state {
  const threadKey = scopedThreadKey(ref);
  if (
    honorDismissal &&
    source.kind === "browser" &&
    state.dismissedTabIdsByThreadKey[threadKey]?.includes(source.tabId)
  ) {
    return state;
  }
  const current = state.byThreadKey[threadKey];
  if (
    current &&
    previewMiniPlayerSourceKey(current.source) === previewMiniPlayerSourceKey(source)
  ) {
    return state;
  }
  return {
    byThreadKey: {
      ...state.byThreadKey,
      [threadKey]: {
        source,
        position: current?.position ?? null,
        width: current?.width ?? null,
      },
    },
  };
}

export function normalizePersistedMiniPlayerState(persistedState: unknown): {
  dismissedTabIdsByThreadKey: Record<string, readonly string[]>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { dismissedTabIdsByThreadKey: {} };
  }
  const raw = (persistedState as { dismissedTabIdsByThreadKey?: unknown })
    .dismissedTabIdsByThreadKey;
  if (!raw || typeof raw !== "object") return { dismissedTabIdsByThreadKey: {} };
  const dismissedTabIdsByThreadKey: Record<string, readonly string[]> = {};
  for (const [threadKey, tabIds] of Object.entries(raw)) {
    if (!Array.isArray(tabIds)) continue;
    const ids = tabIds.filter((id): id is string => typeof id === "string");
    if (ids.length > 0) dismissedTabIdsByThreadKey[threadKey] = ids;
  }
  return { dismissedTabIdsByThreadKey };
}

export const usePreviewMiniPlayerStore = create<PreviewMiniPlayerStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      dismissedTabIdsByThreadKey: {},
      open: (ref, source) => set((state) => openedPlayer(state, ref, source, false)),
      openIfNotDismissed: (ref, tabId) =>
        set((state) => openedPlayer(state, ref, browserMiniPlayerSource(tabId), true)),
      dismiss: (ref, tabId) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const current = state.byThreadKey[threadKey];
          const currentIsTab = current?.source.kind === "browser" && current.source.tabId === tabId;
          const dismissed = state.dismissedTabIdsByThreadKey[threadKey] ?? [];
          const alreadyDismissed = dismissed.includes(tabId);
          if (alreadyDismissed && !currentIsTab) return state;
          const { [threadKey]: _closed, ...restByThreadKey } = state.byThreadKey;
          return {
            byThreadKey: currentIsTab ? restByThreadKey : state.byThreadKey,
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
      move: (ref, sourceKey, position) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const current = state.byThreadKey[threadKey];
          if (!current || previewMiniPlayerSourceKey(current.source) !== sourceKey) return state;
          if (current.position?.x === position.x && current.position.y === position.y) return state;
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { ...current, position },
            },
          };
        }),
      resize: (ref, sourceKey, width) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const current = state.byThreadKey[threadKey];
          if (
            !current ||
            previewMiniPlayerSourceKey(current.source) !== sourceKey ||
            current.width === width
          ) {
            return state;
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { ...current, width },
            },
          };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.byThreadKey) &&
            !(threadKey in state.dismissedTabIdsByThreadKey)
          ) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _dismissed, ...dismissedTabIdsByThreadKey } =
            state.dismissedTabIdsByThreadKey;
          return { byThreadKey, dismissedTabIdsByThreadKey };
        }),
    }),
    {
      name: PREVIEW_MINI_PLAYER_STORAGE_KEY,
      storage: createJSONStorage(resolveLocalStorage),
      partialize: (state) => ({
        dismissedTabIdsByThreadKey: state.dismissedTabIdsByThreadKey,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedMiniPlayerState(persistedState),
      }),
    },
  ),
);

export function selectThreadPreviewMiniPlayer(
  byThreadKey: Record<string, PreviewMiniPlayerState>,
  ref: ScopedThreadRef | null | undefined,
): PreviewMiniPlayerState | null {
  if (!ref) return null;
  return byThreadKey[scopedThreadKey(ref)] ?? null;
}

/** The floating browser tab, or null when nothing floats or a device does. */
export function selectThreadPreviewMiniPlayerTabId(
  byThreadKey: Record<string, PreviewMiniPlayerState>,
  ref: ScopedThreadRef | null | undefined,
): string | null {
  const source = selectThreadPreviewMiniPlayer(byThreadKey, ref)?.source;
  return source?.kind === "browser" ? source.tabId : null;
}
