export const DRAFT_HERO_TRANSITION_ANIMATION_ID = "t3-draft-hero-transition";
export const DRAFT_HERO_TRANSITION_DURATION_MS = 180;
export const DRAFT_HERO_TRANSITION_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
export const SCENERY_DRAFT_HERO_TRANSITION_DURATION_MS = 420;
export const SCENERY_DRAFT_HERO_TRANSITION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
export const MOBILE_COMPOSER_VIEW_TRANSITION_NAME = "t3-mobile-composer";
export const MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME = "t3-mobile-draft-headline";
/** Ignore sub-pixel layout noise; anything smaller is already at rest. */
export const DRAFT_HERO_GLIDE_MIN_PX = 0.5;
/**
 * The 2% scale pop is a landing cue for a real hero↔docked travel, not a
 * correction. Draft→thread promotion remounts often differ by a few pixels
 * once the context strip or credit lands; scaling those makes the composer
 * bounce after it has already settled.
 */
export const DRAFT_HERO_POP_MIN_TRAVEL_PX = 120;

/**
 * Composer rect handed across a ChatView remount. Thread and draft routes are
 * different route components, so "New thread" from a thread (docked → hero)
 * and opening a thread from a draft (hero → docked) both unmount and remount
 * ChatView. The outgoing view records where its composer was; a view that
 * mounts within {@link DRAFT_HERO_HANDOFF_MAX_AGE_MS} glides in from there
 * when placement actually changed, or when a glide was still running. A
 * settled docked→docked remount (draft promotion after the in-place dock)
 * must not replay that FLIP — a 2% scale on a few leftover pixels is the
 * bounce after the composer has already landed. Anything older is a stale
 * record from an unrelated navigation and is ignored.
 */
export const DRAFT_HERO_HANDOFF_MAX_AGE_MS = 400;

type ComposerRect = Pick<DOMRect, "left" | "top">;

export type DraftHeroHandoff = {
  readonly rect: ComposerRect;
  readonly isDraftHero: boolean;
  readonly gliding: boolean;
};

export type DraftHeroHandoffExtras = {
  readonly isDraftHero: boolean;
  readonly gliding: boolean;
};

let draftHeroHandoff: (DraftHeroHandoff & { readonly at: number }) | null = null;

export function recordDraftHeroHandoff(
  rect: ComposerRect | null,
  now: number,
  extras: DraftHeroHandoffExtras = { isDraftHero: false, gliding: false },
): void {
  draftHeroHandoff = rect
    ? {
        rect: { left: rect.left, top: rect.top },
        isDraftHero: extras.isDraftHero,
        gliding: extras.gliding,
        at: now,
      }
    : null;
}

/** Consumes the record: a handoff glides exactly one mount, never a later one. */
export function takeDraftHeroHandoff(now: number): DraftHeroHandoff | null {
  const handoff = draftHeroHandoff;
  draftHeroHandoff = null;
  if (!handoff || now - handoff.at > DRAFT_HERO_HANDOFF_MAX_AGE_MS) {
    return null;
  }
  return {
    rect: handoff.rect,
    isDraftHero: handoff.isDraftHero,
    gliding: handoff.gliding,
  };
}

export function isDraftHeroAnimationPlaying(animation: Animation | null): boolean {
  return animation?.playState === "running" || animation?.playState === "paused";
}

/**
 * A remount glides only when placement crossed hero↔docked, or when the
 * outgoing view was still mid-glide so the motion can finish on the incoming
 * ChatView. In-place hero↔docked is decided by the caller.
 */
export function shouldGlideDraftHeroHandoff(input: {
  readonly isDraftHero: boolean;
  readonly handoff: DraftHeroHandoff | null;
}): boolean {
  if (input.handoff === null) {
    return false;
  }
  return input.handoff.isDraftHero !== input.isDraftHero || input.handoff.gliding;
}

export function shouldPopDraftHeroGlide(input: {
  readonly sceneryDock: boolean;
  readonly inPlace: boolean;
  readonly translateY: number;
}): boolean {
  return (
    input.sceneryDock && input.inPlace && Math.abs(input.translateY) >= DRAFT_HERO_POP_MIN_TRAVEL_PX
  );
}

export function draftHeroGlideHasTravel(translateX: number, translateY: number): boolean {
  return (
    Math.abs(translateX) >= DRAFT_HERO_GLIDE_MIN_PX ||
    Math.abs(translateY) >= DRAFT_HERO_GLIDE_MIN_PX
  );
}

export function draftHeroGlideKeyframes(
  translateX: number,
  translateY: number,
  pop: boolean,
): { transform: string }[] {
  if (pop) {
    return [
      { transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(1.02)` },
      { transform: "translate3d(0, 0, 0) scale(1)" },
    ];
  }
  return [
    { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
    { transform: "translate3d(0, 0, 0)" },
  ];
}

type ComposerViewTransition = {
  readonly finished: Promise<void>;
};

let activeMobileComposerTransition: Promise<void> | null = null;

type ComposerViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ComposerViewTransition;
};

export async function waitForDraftHeroTransition(): Promise<void> {
  const mobileComposerTransition = activeMobileComposerTransition;
  if (typeof document === "undefined" || typeof document.getAnimations !== "function") {
    await mobileComposerTransition;
    return;
  }

  const activeTransitions = document
    .getAnimations()
    .filter((animation) => animation.id === DRAFT_HERO_TRANSITION_ANIMATION_ID);

  await Promise.all([
    mobileComposerTransition,
    ...activeTransitions.map(async (animation) => {
      try {
        await animation.finished;
      } catch {
        // A cancelled transition is already safe to hand off.
      }
    }),
  ]);
}

export async function runMobileComposerTransition(
  update: () => void | Promise<void>,
): Promise<void> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    await update();
    return;
  }

  const transitionDocument = document as ComposerViewTransitionDocument;
  const mobileViewport = window.matchMedia?.("(max-width: 639px)").matches ?? false;
  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (!mobileViewport || prefersReducedMotion || !transitionDocument.startViewTransition) {
    await update();
    return;
  }

  let updateStarted = false;
  const runUpdate = async () => {
    if (updateStarted) return;
    updateStarted = true;
    await update();
  };
  let transitionFinished: Promise<void> | null = null;
  transitionDocument.documentElement.dataset.mobileComposerRouteTransition = "true";
  try {
    const transition = transitionDocument.startViewTransition(runUpdate);
    transitionFinished = transition.finished.catch(() => undefined);
    activeMobileComposerTransition = transitionFinished;
    try {
      await transition.finished;
    } catch {
      await runUpdate();
    }
  } catch {
    await runUpdate();
  } finally {
    if (activeMobileComposerTransition === transitionFinished) {
      activeMobileComposerTransition = null;
    }
    delete transitionDocument.documentElement.dataset.mobileComposerRouteTransition;
  }
}
