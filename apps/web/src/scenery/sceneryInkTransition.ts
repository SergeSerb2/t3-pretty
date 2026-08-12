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
 * mix-blend-mode is forced to `normal` in scenery.css: the default
 * plus-lighter crossfade flashes a bright frame between a light and dark
 * snapshot, which is the opposite of what this transition is for.
 */

export const SCENERY_INK_TRANSITION_MS = 300;
export const SCENERY_INK_TRANSITION_EASING = "cubic-bezier(0.77, 0, 0.175, 1)";

type InkViewTransition = {
  readonly finished: Promise<void>;
};

type InkViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => InkViewTransition;
};

let inkTransitionGeneration = 0;

export function canAnimateSceneryInkTransition(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }
  const transitionDocument = document as InkViewTransitionDocument;
  if (typeof transitionDocument.startViewTransition !== "function") {
    return false;
  }
  return !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/**
 * Run `update` inside a document view transition when the ink appearance
 * actually flips. Always invokes `update` exactly once.
 */
export function runSceneryInkTransition(update: () => void): void {
  if (!canAnimateSceneryInkTransition()) {
    update();
    return;
  }

  const transitionDocument = document as InkViewTransitionDocument;
  const root = transitionDocument.documentElement;
  const generation = ++inkTransitionGeneration;
  let updateStarted = false;
  const runUpdate = () => {
    if (updateStarted) {
      return;
    }
    updateStarted = true;
    update();
  };

  root.dataset.sceneryInkTransition = "true";
  const clear = () => {
    if (generation !== inkTransitionGeneration) {
      return;
    }
    delete root.dataset.sceneryInkTransition;
  };

  try {
    const transition = transitionDocument.startViewTransition!(runUpdate);
    void transition.finished.then(clear, () => {
      runUpdate();
      clear();
    });
  } catch {
    clear();
    runUpdate();
  }
}
