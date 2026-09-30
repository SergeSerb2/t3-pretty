import * as QuickActions from "expo-quick-actions";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useLinkTo, type NavigationState } from "@react-navigation/native";

import {
  loadRecentThreadShortcuts,
  saveRecentThreadShortcuts,
  type RecentThreadShortcut,
} from "../../persistence/imperative";
import { LatestOnlyAsyncQueue } from "../../lib/serialized-async-queue";
import { useThreadShell } from "../../state/entities";
import {
  activeThreadRef,
  buildShortcutActions,
  normalizeRecentThreadShortcuts,
  shortcutHref,
  withRecentThreadShortcut,
} from "./appShortcuts";

const RECENT_THREAD_SHORTCUTS_LOAD_TIMEOUT_MS = 10_000;

// Keep presentation/storage writes ordered across root-navigation remounts.
// A hook-owned queue can finish after its replacement and overwrite newer
// launcher items during development remounts or navigation resets.
const recentThreadShortcutSaveQueue = new LatestOnlyAsyncQueue<ReadonlyArray<RecentThreadShortcut>>(
  saveRecentThreadShortcuts,
  (error) => console.warn("[app-shortcuts] failed to persist recent threads", error),
);
const launcherShortcutQueue = new LatestOnlyAsyncQueue<ReadonlyArray<RecentThreadShortcut>>(
  (threads) => QuickActions.setItems(buildShortcutActions(threads)),
  (error) => console.warn("[app-shortcuts] failed to update launcher shortcuts", error),
);
let hasHandledInitialShortcutAction = false;

async function loadRecentThreadShortcutsWithDeadline(): Promise<
  ReadonlyArray<RecentThreadShortcut>
> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      loadRecentThreadShortcuts(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Recent thread shortcut load timed out.")),
          RECENT_THREAD_SHORTCUTS_LOAD_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Owns the launcher app shortcuts (Android long-press menu): keeps the
 * static "New task" entry plus the recently opened threads in sync, and
 * routes shortcut taps — cold start included — to their in-app screens.
 * Mounted once in the root stack layout.
 */
export function useAppShortcuts(state: NavigationState): void {
  useShortcutNavigation();
  useRecentThreadShortcutSync(state);
}

function useShortcutNavigation(): void {
  const linkTo = useLinkTo();

  useEffect(() => {
    // Cold start: the tapped shortcut arrives as the launch action, before
    // any listener can fire. Navigating from here pushes the target over the
    // initial Home route, so back returns home instead of exiting the app.
    if (!hasHandledInitialShortcutAction) {
      const initialHref = QuickActions.initial ? shortcutHref(QuickActions.initial) : null;
      try {
        if (initialHref !== null) {
          linkTo(initialHref);
        }
        // Commit only after routing succeeds. If the navigation root is
        // replaced while mounting, a later remount can still retry the launch
        // action instead of treating a failed attempt as handled forever.
        hasHandledInitialShortcutAction = true;
      } catch (error) {
        console.warn("[app-shortcuts] failed to route launch action", error);
      }
    }

    const subscription = QuickActions.addListener((action) => {
      const href = shortcutHref(action);
      if (href !== null) {
        try {
          linkTo(href);
        } catch (error) {
          console.warn("[app-shortcuts] failed to route shortcut action", error);
        }
      }
    });
    return () => subscription.remove();
  }, [linkTo]);
}

function useRecentThreadShortcutSync(state: NavigationState): void {
  // Launcher shortcuts are Android-only. A null ref on iOS keeps this hook
  // (mounted in the root stack layout) from subscribing the root to the
  // active thread's shell, which would re-render every screen on each
  // title/status/session change.
  const threadRef = useMemo(
    () => (Platform.OS === "android" ? activeThreadRef(state) : null),
    [state],
  );
  const threadShell = useThreadShell(threadRef);
  // null until the persisted list loads; recording waits on it so the first
  // thread opened after a cold start cannot clobber older entries.
  const [recents, setRecents] = useState<ReadonlyArray<RecentThreadShortcut> | null>(null);
  // Gates storage writes: a failed load falls back to an empty in-memory
  // list (so the launcher still gets the "New task" item), but persisting
  // that fallback would erase valid history over a transient read error.
  // Real thread opens flip this on — by then the list is the new truth.
  const persistableRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    let cancelled = false;
    void loadRecentThreadShortcutsWithDeadline()
      .then((threads) => {
        if (!cancelled) {
          persistableRef.current = true;
          setRecents(normalizeRecentThreadShortcuts(threads));
        }
      })
      .catch((error) => {
        console.warn("[app-shortcuts] failed to load recent threads", error);
        if (!cancelled) {
          setRecents([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loaded = recents !== null;
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const title = threadShell?.title ?? "";
  useEffect(() => {
    if (!loaded || environmentId === null || threadId === null) {
      return;
    }

    // withRecentThreadShortcut returns the same array when nothing changed,
    // so React bails out and the persist effect below does not re-fire.
    setRecents((current) => {
      if (current === null) {
        return current;
      }
      const next = withRecentThreadShortcut(current, { environmentId, threadId, title });
      if (next !== current) {
        persistableRef.current = true;
      }
      return next;
    });
  }, [loaded, environmentId, threadId, title]);

  useEffect(() => {
    if (recents === null) {
      return;
    }

    if (persistableRef.current) {
      recentThreadShortcutSaveQueue.enqueue(recents);
    }
    launcherShortcutQueue.enqueue(recents);
  }, [recents]);
}
