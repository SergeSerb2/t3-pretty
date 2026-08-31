/**
 * The fork's motion driver: watches upstream's chat DOM through a
 * MutationObserver and gives the thread its animation layer without touching
 * upstream files.
 *
 * Two jobs:
 *
 * 1. Row arrivals — tag a timeline row wrapper with `scenery-row-enter`
 *    (motion.css animates it) the FIRST time its row id is seen. Guards
 *    against the two virtualization traps: a thread switch replays every
 *    row (suppressed by seeding the first paint for that thread, not a
 *    wall-clock window that expires while messages are still loading), and
 *    scrolling up mounts older rows (suppressed by only animating rows
 *    that sit at/after the furthest content already seen).
 *
 * 2. The html[data-scenery-motion] gate every motion.css rule hangs off,
 *    bound to the quick-settings Motion toggle.
 *
 * Thinking status stays on upstream's three-dot pulse cluster.
 */
import { useEffect, useRef } from "react";

import { useMotionStore } from "./motionStore";
import { mutationsRequireSceneryMotionSync, ROW_WRAPPER_SELECTOR } from "./sceneryMotionMutations";
import {
  ENTER_CLASS,
  ENTER_CLEAR_MS,
  ENTER_DELAY_PROP,
  enterDelayMs,
  isSceneryInkTransitionActive,
  shouldAnimateRowArrival,
  shouldDeferThreadSeed,
  SILENT_WINDOW_MS,
} from "./sceneryMotionRowArrivals";
import { useActiveThreadKey } from "./useActiveThreadKey";
import "./motion.css";

const SEEN_CAP = 5000;

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
    const enterCleanups = new Set<() => void>();
    let queued = false;
    let syncFrame: number | null = null;

    const clearEnter = (wrapper: HTMLElement) => {
      wrapper.classList.remove(ENTER_CLASS);
      wrapper.style.removeProperty(ENTER_DELAY_PROP);
    };

    const tagEnter = (wrapper: HTMLElement, delayMs: number) => {
      wrapper.style.setProperty(ENTER_DELAY_PROP, `${delayMs}ms`);
      wrapper.classList.add(ENTER_CLASS);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        clearEnter(wrapper);
        wrapper.removeEventListener("animationend", cleanup);
        wrapper.removeEventListener("animationcancel", cleanup);
        window.clearTimeout(timeout);
        enterCleanups.delete(cleanup);
      };
      const timeout = window.setTimeout(cleanup, ENTER_CLEAR_MS);
      wrapper.addEventListener("animationend", cleanup);
      wrapper.addEventListener("animationcancel", cleanup);
      enterCleanups.add(cleanup);
    };

    const syncRowArrivals = () => {
      const wrappers = [...document.querySelectorAll<HTMLElement>(ROW_WRAPPER_SELECTOR)];
      const currentThreadKey = threadKeyRef.current;
      const firstPaintForThread = seededThreadKeyRef.current !== currentThreadKey;
      const root = document.documentElement;
      const silentWindowActive = performance.now() < silentUntilRef.current;
      const inkTransitionActive = isSceneryInkTransitionActive(root);
      const noTransitions = root.classList.contains("no-transitions");
      let maxSeenTop = Number.NEGATIVE_INFINITY;
      const unseen: Array<{ wrapper: HTMLElement; id: string; top: number }> = [];
      let observed = 0;
      for (const wrapper of wrappers) {
        const id = wrapper
          .querySelector("[data-timeline-row-id]")
          ?.getAttribute("data-timeline-row-id");
        if (!id) {
          continue;
        }
        observed++;
        if (seenRowIds.has(id)) {
          maxSeenTop = Math.max(maxSeenTop, wrapper.getBoundingClientRect().top);
        } else {
          unseen.push({ wrapper, id, top: wrapper.getBoundingClientRect().top });
        }
      }
      if (shouldDeferThreadSeed(firstPaintForThread, observed)) {
        return;
      }
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
          inkTransitionActive,
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
    sync();

    return () => {
      observer.disconnect();
      if (syncFrame !== null) {
        cancelAnimationFrame(syncFrame);
      }
      for (const cleanup of enterCleanups) {
        cleanup();
      }
      enterCleanups.clear();
      document.documentElement.removeAttribute("data-scenery-motion");
    };
  }, [enabled]);

  return null;
}

export default SceneryMotion;
