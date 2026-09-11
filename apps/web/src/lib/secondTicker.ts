/**
 * One visibility-aware second ticker for elapsed-time labels that update their
 * own DOM nodes. A busy workspace can render many labels, but it should still
 * own only one interval and do no work while the document is hidden.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One stale consumer must not prevent every other elapsed label updating.
    }
  }
}

function syncTimer(): void {
  const visible = typeof document !== "undefined" && !document.hidden;
  const shouldRun = listeners.size > 0 && visible;
  if (shouldRun && timer === null) {
    timer = setInterval(tick, 1_000);
  } else if (!shouldRun && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function handleVisibilityChange(): void {
  if (!document.hidden) tick();
  syncTimer();
}

export function subscribeSecondTick(listener: () => void): () => void {
  if (listeners.size === 0 && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
  listeners.add(listener);
  listener();
  syncTimer();
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    listeners.delete(listener);
    if (listeners.size === 0 && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
    syncTimer();
  };
}
