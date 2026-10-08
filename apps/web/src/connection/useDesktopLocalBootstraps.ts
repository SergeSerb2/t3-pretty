import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import {
  readDesktopSecondaryBootstraps,
  subscribeDesktopSecondaryBootstraps,
} from "./desktopLocal";

const DESKTOP_LOCAL_BOOTSTRAP_POLL_MS = 2_000;
const EMPTY_DESKTOP_LOCAL_BOOTSTRAPS: ReadonlyArray<DesktopEnvironmentBootstrap> = [];

type PollInterval = ReturnType<typeof globalThis.setInterval>;

interface DesktopLocalBootstrapsStoreOptions {
  readonly read: () => ReadonlyArray<DesktopEnvironmentBootstrap>;
  readonly isVisible: () => boolean;
  readonly subscribeVisibility: (listener: () => void) => () => void;
  readonly subscribeSource?: (
    listener: (bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>) => void,
  ) => () => void;
  readonly pollIntervalMs?: number;
  readonly setInterval?: (listener: () => void, delay: number) => PollInterval;
  readonly clearInterval?: (interval: PollInterval) => void;
}

interface DesktopLocalBootstrapsStore {
  readonly getSnapshot: () => ReadonlyArray<DesktopEnvironmentBootstrap>;
  readonly subscribe: (listener: () => void) => () => void;
}

function isSameBootstrap(
  left: DesktopEnvironmentBootstrap,
  right: DesktopEnvironmentBootstrap,
): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.runningDistro === right.runningDistro &&
    left.httpBaseUrl === right.httpBaseUrl &&
    left.wsBaseUrl === right.wsBaseUrl &&
    left.bootstrapToken === right.bootstrapToken
  );
}

function isSameTopology(
  left: ReadonlyArray<DesktopEnvironmentBootstrap>,
  right: ReadonlyArray<DesktopEnvironmentBootstrap>,
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => isSameBootstrap(entry, right[index]!))
  );
}

/**
 * One lifecycle for all React consumers of the host-managed desktop topology.
 * Stable snapshots keep useSyncExternalStore from re-rendering consumers when
 * the bridge returns equivalent arrays, and polling sleeps with the document.
 */
export function createDesktopLocalBootstrapsStore(
  options: DesktopLocalBootstrapsStoreOptions,
): DesktopLocalBootstrapsStore {
  const listeners = new Set<() => void>();
  const pollIntervalMs = options.pollIntervalMs ?? DESKTOP_LOCAL_BOOTSTRAP_POLL_MS;
  const scheduleInterval = options.setInterval ?? globalThis.setInterval;
  const cancelInterval = options.clearInterval ?? globalThis.clearInterval;
  let snapshot = EMPTY_DESKTOP_LOCAL_BOOTSTRAPS;
  let initialized = false;
  let pollInterval: PollInterval | null = null;
  let unsubscribeVisibility: (() => void) | null = null;
  let unsubscribeSource: (() => void) | null = null;

  const updateSnapshot = (next: ReadonlyArray<DesktopEnvironmentBootstrap>) => {
    initialized = true;
    if (isSameTopology(snapshot, next)) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const getSnapshot = () => {
    if (initialized) {
      return snapshot;
    }
    initialized = true;
    try {
      snapshot = options.read();
    } catch {
      // The bridge may not exist during SSR or very early desktop bootstrap.
      // Retain the stable empty snapshot and let the first visible poll retry.
    }
    return snapshot;
  };

  const poll = () => {
    let next: ReadonlyArray<DesktopEnvironmentBootstrap>;
    try {
      next = options.read();
    } catch {
      return;
    }
    updateSnapshot(next);
  };

  const stopPolling = () => {
    if (pollInterval === null) {
      return;
    }
    cancelInterval(pollInterval);
    pollInterval = null;
  };

  const syncPolling = () => {
    stopPolling();
    if (listeners.size === 0 || !options.isVisible()) {
      return;
    }
    poll();
    if (listeners.size === 0 || !options.isVisible()) {
      return;
    }
    pollInterval = scheduleInterval(poll, pollIntervalMs);
  };

  return {
    getSnapshot,
    subscribe: (listener) => {
      const isFirstSubscriber = listeners.size === 0;
      listeners.add(listener);
      if (isFirstSubscriber) {
        unsubscribeSource = options.subscribeSource?.(updateSnapshot) ?? null;
        unsubscribeVisibility = options.subscribeVisibility(syncPolling);
        syncPolling();
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size !== 0) {
          return;
        }
        stopPolling();
        unsubscribeVisibility?.();
        unsubscribeVisibility = null;
        unsubscribeSource?.();
        unsubscribeSource = null;
      };
    },
  };
}

const desktopLocalBootstrapsStore = createDesktopLocalBootstrapsStore({
  read: readDesktopSecondaryBootstraps,
  subscribeSource: subscribeDesktopSecondaryBootstraps,
  isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
  subscribeVisibility: (listener) => {
    if (typeof document === "undefined") {
      return () => {};
    }
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
});

/**
 * Reactively track the desktop's secondary local backends (e.g. a parallel WSL
 * backend). The bridge exposes no change event, so one shared store re-reads on
 * an interval while the document is visible. Failed reads retain the latest
 * successful snapshot, while a successful empty read clears it.
 */
export function useDesktopLocalBootstraps(): ReadonlyArray<DesktopEnvironmentBootstrap> {
  return useSyncExternalStore(
    desktopLocalBootstrapsStore.subscribe,
    desktopLocalBootstrapsStore.getSnapshot,
    desktopLocalBootstrapsStore.getSnapshot,
  );
}
