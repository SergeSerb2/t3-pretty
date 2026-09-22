/**
 * The fork's motion driver: watches upstream's chat DOM through a
 * MutationObserver and gives the thread its animation layer without touching
 * upstream files.
 *
 * Three jobs:
 *
 * 1. Row arrivals — tag a timeline row wrapper with `scenery-row-enter`
 *    (motion.css animates it) the FIRST time its row id is seen. Guards
 *    against the two virtualization traps: a thread switch replays every
 *    row (suppressed by seeding the first paint for that thread, not a
 *    wall-clock window that expires while messages are still loading), and
 *    scrolling up mounts older rows (suppressed by only animating rows
 *    that sit at/after the furthest content already seen).
 *
 * 2. Disclosure reveals — when the user opens a disclosure in a timeline
 *    row, tag what the open adds (sceneryMotionReveals): rows mounted under
 *    a turn fold or tool group get `scenery-row-reveal`, bodies mounted in
 *    the row get `scenery-reveal`. The click or Enter/Space is the only
 *    trigger, so restores, thread switches and virtualized re-mounts stay
 *    still.
 *
 * 3. The html[data-scenery-motion] gate every motion.css rule hangs off,
 *    bound to the quick-settings Motion toggle.
 *
 * Thinking status stays on upstream's shimmer row.
 */
import { useEffect, useRef } from "react";

import { useMotionStore } from "./motionStore";
import { mutationsRequireSceneryMotionSync, ROW_WRAPPER_SELECTOR } from "./sceneryMotionMutations";
import {
  collectInRowReveals,
  isRevealedRow,
  REVEAL_CLASS,
  REVEAL_CLEAR_MS,
  REVEAL_DELAY_PROP,
  revealDelayMs,
  revealIntentIsLive,
  resolveRevealIntent,
  ROW_REVEAL_CLASS,
  type RevealIntent,
} from "./sceneryMotionReveals";
import {
  ENTER_CLASS,
  ENTER_CLEAR_MS,
  ENTER_DELAY_PROP,
  enterDelayMs,
  shouldAnimateRowArrival,
  shouldDeferThreadSeed,
  SILENT_WINDOW_MS,
} from "./sceneryMotionRowArrivals";
import { useActiveThreadKey } from "./useActiveThreadKey";
import "./motion.css";

const SEEN_CAP = 5000;
const ROW_ID_SELECTOR = "[data-timeline-row-id]";

function rowIdSelector(rowId: string): string {
  return `[data-timeline-row-id="${CSS.escape(rowId)}"]`;
}

function readMountedRowIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of document.querySelectorAll(ROW_ID_SELECTOR)) {
    const id = row.getAttribute("data-timeline-row-id");
    if (id) ids.add(id);
  }
  return ids;
}

export function SceneryMotion() {
  const enabled = useMotionStore((state) => state.enabled);
  const threadKey = useActiveThreadKey();

  // A thread switch (or first mount) opens the silent window. Loading often
  // outlasts that window, so the first observation that actually sees rows
  // for this thread also seeds instead of animating — otherwise
  // `scenery-row-enter` with fill-mode `both` can leave the timeline at
  // opacity 0 if animationend never fires.
  //
  // Reset during render, not in an effect: leftover rows from the thread
  // being left can mutate into the observer before a useEffect runs, and
  // seeding against those would mark the new thread as already first-painted
  // so its real rows animate in (translate + overflow-x-clip) after the
  // silent window expires.
  const silentUntilRef = useRef(
    typeof performance !== "undefined" ? performance.now() + SILENT_WINDOW_MS : 0,
  );
  const threadKeyRef = useRef(threadKey);
  const seededThreadKeyRef = useRef<string | null>(null);
  const seenRowIdsRef = useRef(new Set<string>());
  if (threadKeyRef.current !== threadKey) {
    threadKeyRef.current = threadKey;
    silentUntilRef.current =
      typeof performance !== "undefined" ? performance.now() + SILENT_WINDOW_MS : 0;
    seededThreadKeyRef.current = null;
    seenRowIdsRef.current.clear();
  }

  useEffect(() => {
    if (!enabled || typeof document === "undefined") {
      return;
    }
    document.documentElement.setAttribute("data-scenery-motion", "");

    seenRowIdsRef.current = new Set<string>();
    const seenRowIds = seenRowIdsRef.current;
    const tagCleanups = new Set<() => void>();
    let revealIntent: RevealIntent | null = null;
    // Rows the current intent already revealed. A reveal finishes inside the
    // intent window, so a later sync must not tag the same row again.
    let revealedRowIds = new Set<string>();
    let queued = false;
    let syncFrame: number | null = null;

    const clearEnter = (wrapper: HTMLElement) => {
      wrapper.classList.remove(ENTER_CLASS);
      wrapper.style.removeProperty(ENTER_DELAY_PROP);
    };

    /**
     * One-shot motion.css class. `animated` is the element whose animation
     * ends it: animationend bubbles, so a descendant's animation must not
     * clear it early. The timeout covers the kill switch and nodes that
     * leave the document mid-animation.
     */
    const tagAnimation = (options: {
      element: HTMLElement;
      animated: () => Element | null;
      className: string;
      delay?: { prop: string; ms: number };
      clearMs: number;
    }) => {
      const { element, className, delay } = options;
      if (delay) element.style.setProperty(delay.prop, `${delay.ms}ms`);
      element.classList.add(className);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        element.classList.remove(className);
        if (delay) element.style.removeProperty(delay.prop);
        element.removeEventListener("animationend", onAnimationDone);
        element.removeEventListener("animationcancel", onAnimationDone);
        window.clearTimeout(timeout);
        tagCleanups.delete(cleanup);
      };
      const onAnimationDone = (event: Event) => {
        if (event.target === options.animated()) cleanup();
      };
      const timeout = window.setTimeout(cleanup, options.clearMs);
      element.addEventListener("animationend", onAnimationDone);
      element.addEventListener("animationcancel", onAnimationDone);
      tagCleanups.add(cleanup);
    };

    const tagEnter = (wrapper: HTMLElement, delayMs: number) => {
      tagAnimation({
        element: wrapper,
        animated: () => wrapper.firstElementChild,
        className: ENTER_CLASS,
        delay: { prop: ENTER_DELAY_PROP, ms: delayMs },
        clearMs: ENTER_CLEAR_MS,
      });
    };

    const onRevealGesture = (event: MouseEvent | KeyboardEvent) => {
      if (event.type === "keydown") {
        const { key } = event as KeyboardEvent;
        if (key !== "Enter" && key !== " ") return;
      }
      const intent = resolveRevealIntent(event.target, performance.now(), readMountedRowIds);
      if (!intent) return;
      revealIntent = intent;
      revealedRowIds = new Set<string>();
    };

    const revealInRow = (mutations: ReadonlyArray<MutationRecord>, intent: RevealIntent) => {
      const row = document.querySelector(rowIdSelector(intent.rowId));
      if (!row) return;
      for (const element of collectInRowReveals(mutations, intent, row)) {
        if (!(element instanceof HTMLElement)) continue;
        tagAnimation({
          element,
          animated: () => element,
          className: REVEAL_CLASS,
          clearMs: REVEAL_CLEAR_MS,
        });
      }
    };

    const syncRowArrivals = () => {
      const wrappers = [...document.querySelectorAll<HTMLElement>(ROW_WRAPPER_SELECTOR)];
      const currentThreadKey = threadKeyRef.current;
      const firstPaintForThread = seededThreadKeyRef.current !== currentThreadKey;
      const root = document.documentElement;
      const now = performance.now();
      const silentWindowActive = now < silentUntilRef.current;
      const noTransitions = root.classList.contains("no-transitions");
      // A thread's first paint is seeded, never revealed, even mid-gesture.
      const intent =
        !firstPaintForThread && !noTransitions && revealIntentIsLive(revealIntent, now)
          ? revealIntent
          : null;
      const intentRowTop = intent
        ? (document.querySelector(rowIdSelector(intent.rowId))?.getBoundingClientRect().top ?? null)
        : null;
      let maxSeenTop = Number.NEGATIVE_INFINITY;
      const unseen: Array<{ wrapper: HTMLElement; id: string; top: number }> = [];
      const revealed: Array<{ wrapper: HTMLElement; top: number }> = [];
      let observed = 0;
      for (const wrapper of wrappers) {
        const id = wrapper
          .querySelector("[data-timeline-row-id]")
          ?.getAttribute("data-timeline-row-id");
        if (!id) {
          continue;
        }
        observed++;
        const top = wrapper.getBoundingClientRect().top;
        if (
          intent &&
          intentRowTop !== null &&
          !revealedRowIds.has(id) &&
          isRevealedRow({ id, top }, intent, intentRowTop)
        ) {
          // Rows a fold or tool group mounted unfold from its header, whether
          // or not they were seen before the disclosure last closed.
          revealedRowIds.add(id);
          seenRowIds.add(id);
          revealed.push({ wrapper, top });
          continue;
        }
        if (seenRowIds.has(id)) {
          maxSeenTop = Math.max(maxSeenTop, top);
        } else {
          unseen.push({ wrapper, id, top });
        }
      }
      if (shouldDeferThreadSeed(firstPaintForThread, observed)) {
        return;
      }
      revealed.sort((left, right) => left.top - right.top);
      revealed.forEach(({ wrapper }, index) => {
        clearEnter(wrapper);
        tagAnimation({
          element: wrapper,
          animated: () => wrapper.firstElementChild,
          className: ROW_REVEAL_CLASS,
          delay: { prop: REVEAL_DELAY_PROP, ms: revealDelayMs(index) },
          clearMs: REVEAL_CLEAR_MS,
        });
      });
      if (seenRowIds.size > SEEN_CAP) {
        seenRowIds.clear();
        silentUntilRef.current = performance.now() + SILENT_WINDOW_MS;
      }
      unseen.sort((left, right) => left.top - right.top);
      let batchIndex = 0;
      for (const { wrapper, id, top } of unseen) {
        seenRowIds.add(id);
        const animate = shouldAnimateRowArrival({
          firstPaintForThread,
          silentWindowActive,
          noTransitions,
          top,
          maxSeenTop,
        });
        if (!animate) {
          clearEnter(wrapper);
          continue;
        }
        tagEnter(wrapper, enterDelayMs(batchIndex));
        batchIndex++;
      }
      if (firstPaintForThread) {
        seededThreadKeyRef.current = currentThreadKey;
      }
    };

    const sync = () => {
      queued = false;
      syncFrame = null;
      syncRowArrivals();
    };

    const observer = new MutationObserver((mutations) => {
      // Tag in-row bodies before the frame paints: this callback runs in the
      // microtask after React commits the open. Streaming pays only the null
      // check; an expired gesture is dropped so it holds no detached node.
      if (revealIntent) {
        if (revealIntentIsLive(revealIntent, performance.now())) {
          revealInRow(mutations, revealIntent);
        } else {
          revealIntent = null;
        }
      }
      if (!mutationsRequireSceneryMotionSync(mutations)) {
        return;
      }
      if (!queued) {
        queued = true;
        syncFrame = requestAnimationFrame(sync);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-timeline-row-id", "data-timeline-row-kind"],
    });
    // Capture phase: read aria-expanded before React's handler flips it.
    document.addEventListener("click", onRevealGesture, true);
    document.addEventListener("keydown", onRevealGesture, true);
    sync();

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onRevealGesture, true);
      document.removeEventListener("keydown", onRevealGesture, true);
      if (syncFrame !== null) {
        cancelAnimationFrame(syncFrame);
      }
      for (const cleanup of tagCleanups) {
        cleanup();
      }
      tagCleanups.clear();
      document.documentElement.removeAttribute("data-scenery-motion");
    };
  }, [enabled]);

  return null;
}

export default SceneryMotion;
