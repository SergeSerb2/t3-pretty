import { observeVisibleAnimation, subscribeVisibleAnimationState } from "./visibleAnimation";

/** One sweep of the working-row shine. Matches the previous 2.2s CSS loop. */
export const LIVE_ACTIVITY_PERIOD_MS = 2_200;

/**
 * Shared clock for the working-row shine. A CSS animation sampled the
 * transform on every display refresh (240 Hz on the desktop's panel) for as
 * long as a turn was running. This writes one phase variable about 30 times
 * a second, and only on the rows that are actually shining.
 */
export const LIVE_ACTIVITY_FRAME_MS = 34;

export const LIVE_ACTIVITY_PHASE_PROPERTY = "--live-activity-phase";

interface LiveActivityClockEntry {
  element: HTMLElement;
  elapsed: number;
  lastNow: number | null;
  holders: number;
}

const entries = new Map<HTMLElement, LiveActivityClockEntry>();
let timer: ReturnType<typeof setInterval> | null = null;
let listening = false;
let unsubscribeState: (() => void) | null = null;

function documentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

function tick(now: number): void {
  for (const entry of entries.values()) {
    const running =
      !documentHidden() &&
      entry.element.style.getPropertyValue("--visible-animation-state") === "running";
    if (!running) {
      entry.lastNow = null;
      continue;
    }
    if (entry.lastNow === null) entry.lastNow = now;
    entry.elapsed += now - entry.lastNow;
    entry.lastNow = now;
    const phase = (entry.elapsed % LIVE_ACTIVITY_PERIOD_MS) / LIVE_ACTIVITY_PERIOD_MS;
    entry.element.style.setProperty(LIVE_ACTIVITY_PHASE_PROPERTY, phase.toFixed(4));
  }
}

function anyRunning(): boolean {
  if (documentHidden()) return false;
  for (const entry of entries.values()) {
    if (entry.element.style.getPropertyValue("--visible-animation-state") === "running") {
      return true;
    }
  }
  return false;
}

function syncTimer(): void {
  // A paused row must not keep a 30 fps timer. Scrolling it back on screen
  // reports through subscribeVisibleAnimationState, which calls this again.
  const shouldRun = anyRunning();
  if (shouldRun && timer === null) {
    timer = setInterval(() => tick(Date.now()), LIVE_ACTIVITY_FRAME_MS);
  } else if (!shouldRun && timer !== null) {
    clearInterval(timer);
    timer = null;
    for (const entry of entries.values()) entry.lastNow = null;
    return;
  }
  if (shouldRun) tick(Date.now());
}

function onVisibleAnimationState(element: HTMLElement | SVGElement): void {
  if (!entries.has(element as HTMLElement)) return;
  syncTimer();
}

function onVisibilityChange(): void {
  syncTimer();
}

function ensureVisibilityListener(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
  unsubscribeState = subscribeVisibleAnimationState(onVisibleAnimationState);
}

function releaseVisibilityListener(): void {
  if (!listening || entries.size > 0 || typeof document === "undefined") return;
  listening = false;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  unsubscribeState?.();
  unsubscribeState = null;
}

/** Keep `element` on the shared shine clock until the returned release runs. */
export function registerLiveActivityClock(element: HTMLElement | null): void | (() => void) {
  if (element === null) return;
  const existing = entries.get(element);
  const entry = existing ?? { element, elapsed: 0, lastNow: null, holders: 0 };
  entry.holders += 1;
  entries.set(element, entry);
  ensureVisibilityListener();
  syncTimer();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.holders -= 1;
    if (entry.holders > 0) return;
    entries.delete(element);
    element.style.removeProperty(LIVE_ACTIVITY_PHASE_PROPERTY);
    syncTimer();
    releaseVisibilityListener();
  };
}

/**
 * Pause the shine offscreen, while the window is hidden, and under reduced
 * motion, and drive it from {@link registerLiveActivityClock} while it runs.
 */
export function observeLiveActivityMotion(element: HTMLElement | null): void | (() => void) {
  const stopVisibility = observeVisibleAnimation(element);
  const stopClock = registerLiveActivityClock(element);
  if (stopVisibility === undefined && stopClock === undefined) return;
  return () => {
    stopVisibility?.();
    stopClock?.();
  };
}
