/**
 * Caps how many threads keep a live Chromium guest. Every thread that has ever
 * opened a preview holds a real `<webview>` so offscreen automation keeps
 * working, and each guest costs its own renderer process (tens of MB) plus a
 * share of the GPU pool.
 *
 * Unmounting a guest releases the main-process tab (see desktopTabLifetime), so
 * waking one reloads the tab's last URL and loses page state. That makes this a
 * strict last-resort policy: a thread is pinned while anything is happening to
 * it — a visible surface, a mini player, picture in picture, a running
 * recording, or an in-flight automation request — and only unpinned threads
 * beyond the budget go dormant, oldest use first.
 */
import { useSyncExternalStore } from "react";

export const MAX_RESIDENT_PREVIEW_THREADS = 3;

/**
 * Pinned threads always keep their guest, even past the budget; the remaining
 * slots go to the threads pinned most recently.
 */
export function resolveResidentPreviewThreads(input: {
  readonly threadKeys: readonly string[];
  readonly pinnedKeys: ReadonlySet<string>;
  readonly lastPinnedAt: ReadonlyMap<string, number>;
  readonly limit: number;
}): ReadonlySet<string> {
  const resident = new Set<string>();
  const dormantCandidates: string[] = [];
  for (const threadKey of input.threadKeys) {
    if (input.pinnedKeys.has(threadKey)) {
      resident.add(threadKey);
    } else {
      dormantCandidates.push(threadKey);
    }
  }

  const spare = input.limit - resident.size;
  if (spare <= 0) return resident;

  dormantCandidates
    .sort(
      (left, right) => (input.lastPinnedAt.get(right) ?? 0) - (input.lastPinnedAt.get(left) ?? 0),
    )
    .slice(0, spare)
    .forEach((threadKey) => resident.add(threadKey));
  return resident;
}

const automatingThreads = new Map<string, number>();
const listeners = new Set<() => void>();
let automatingSnapshot: ReadonlySet<string> = new Set();

function publish(): void {
  automatingSnapshot = new Set(automatingThreads.keys());
  for (const listener of listeners) listener();
}

/**
 * Keeps a thread's guests resident for the duration of an automation request,
 * and wakes a dormant one before the request waits for the tab. Returns the
 * release; call it in a `finally`.
 */
export function acquirePreviewGuestThread(threadKey: string): () => void {
  automatingThreads.set(threadKey, (automatingThreads.get(threadKey) ?? 0) + 1);
  publish();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (automatingThreads.get(threadKey) ?? 1) - 1;
    if (remaining > 0) {
      automatingThreads.set(threadKey, remaining);
    } else {
      automatingThreads.delete(threadKey);
    }
    publish();
  };
}

export function readAutomatingPreviewThreads(): ReadonlySet<string> {
  return automatingSnapshot;
}

export function useAutomatingPreviewThreads(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readAutomatingPreviewThreads,
    readAutomatingPreviewThreads,
  );
}
