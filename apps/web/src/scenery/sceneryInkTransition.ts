/**
 * Coordinates a light↔dark ink flip with the photo swap so the palette,
 * wash, and wallpaper dissolve together instead of snapping while the old
 * photo is still on screen.
 *
 * Same-variant thread switches keep the existing CSS photo crossfade. This
 * path is only for an appearance change, and only when View Transitions are
 * available and motion is allowed. Reduced motion and older browsers fall
 * through to a same-frame commit (still better than flipping ink early).
 *
 * The root snapshot must not crossfade the transcript: two bitmaps of the
 * same glyphs composite into the filled-in letter artifacts a thread switch
 * was leaving behind. scenery.css pulls the active chat column out of the
 * root group and cuts it instead. mix-blend-mode is `normal` so the
 * remaining scenery dissolve does not flash plus-lighter between a light and
 * a dark snapshot.
 *
 * A second flip while one transition is capturing must not start another
 * `startViewTransition` (Chromium skips the first and can leave both
 * snapshots on screen) and must not let the first callback commit a stale
 * photo/ink after the second has already landed.
 */

import { useMotionStore } from "./motionStore";

export const SCENERY_INK_TRANSITION_MS = 300;
export const SCENERY_INK_TRANSITION_EASING = "cubic-bezier(0.77, 0, 0.175, 1)";
const SCENERY_INK_TRANSITION_SETTLE_TIMEOUT_MS = SCENERY_INK_TRANSITION_MS + 1_000;

type InkViewTransition = {
  readonly finished: Promise<void>;
};

type InkViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => InkViewTransition;
};

let inkTransitionGeneration = 0;
/** Generation that currently owns `data-scenery-ink-transition`. */
let inkTransitionGateGeneration = 0;

const CHAT_TRANSCRIPT_SELECTOR = "[data-chat-transcript]";
const CHAT_TRANSCRIPT_ACTIVE_ATTR = "data-chat-transcript-active";

type TranscriptPinNode = {
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
};

type TranscriptPinDocument = {
  querySelectorAll?: (selector: string) => ArrayLike<TranscriptPinNode>;
};

/** Keep the ink view-transition name on one transcript even across cousin trees. */
export function pinActiveChatTranscript(doc: TranscriptPinDocument = document): void {
  const nodes = doc.querySelectorAll?.(CHAT_TRANSCRIPT_SELECTOR);
  if (nodes === undefined || nodes.length === 0) {
    return;
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) {
      continue;
    }
    if (index === 0) {
      node.setAttribute(CHAT_TRANSCRIPT_ACTIVE_ATTR, "true");
    } else {
      node.removeAttribute(CHAT_TRANSCRIPT_ACTIVE_ATTR);
    }
  }
}

export function canAnimateSceneryInkTransition(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }
  // Background tabs throttle rAF; a snapshot taken here can stick as a
  // garbled overlay until the tab is focused again.
  if (document.hidden) {
    return false;
  }
  // While useTheme's swap dissolve is mid-flight, a second startViewTransition
  // would skip it and park the scenery layers; commit directly instead.
  if (document.documentElement.dataset.themeSwap !== undefined) {
    return false;
  }
  const transitionDocument = document as InkViewTransitionDocument;
  if (typeof transitionDocument.startViewTransition !== "function") {
    return false;
  }
  if (!useMotionStore.getState().enabled) {
    return false;
  }
  return !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/**
 * Run `update` inside a document view transition when the ink appearance
 * actually flips. Invokes `update` at most once. A flip superseded by a
 * newer call before its callback runs is dropped so it cannot overwrite the
 * newer photo/ink. `animating` tells the update whether a snapshot will
 * really crossfade the change: every fallback (no View Transitions API,
 * reduced motion, a start that throws, is skipped, or is nested in an
 * in-flight transition) passes false so the update can keep its own CSS
 * dissolve instead of parking layers for a snapshot that never happens.
 */
export function runSceneryInkTransition(update: (animating: boolean) => void): void {
  if (!canAnimateSceneryInkTransition()) {
    update(false);
    return;
  }

  const transitionDocument = document as InkViewTransitionDocument;
  const root = transitionDocument.documentElement;
  const generation = ++inkTransitionGeneration;
  let updateStarted = false;
  const runUpdate = (animating: boolean) => {
    if (updateStarted || generation !== inkTransitionGeneration) {
      return;
    }
    updateStarted = true;
    update(animating);
  };
  let settleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const clearGate = () => {
    if (settleTimeoutId !== null) {
      clearTimeout(settleTimeoutId);
      settleTimeoutId = null;
    }
    if (inkTransitionGateGeneration !== generation) {
      return;
    }
    inkTransitionGateGeneration = 0;
    delete root.dataset.sceneryInkTransition;
  };

  if (root.dataset.sceneryInkTransition === "true") {
    runUpdate(false);
    return;
  }

  inkTransitionGateGeneration = generation;
  root.dataset.sceneryInkTransition = "true";
  pinActiveChatTranscript(transitionDocument);

  try {
    const transition = transitionDocument.startViewTransition!(() => {
      runUpdate(true);
      pinActiveChatTranscript(transitionDocument);
    });
    settleTimeoutId = setTimeout(() => {
      runUpdate(false);
      clearGate();
    }, SCENERY_INK_TRANSITION_SETTLE_TIMEOUT_MS);
    void transition.finished.then(clearGate, () => {
      runUpdate(false);
      clearGate();
    });
  } catch {
    clearGate();
    runUpdate(false);
  }
}
