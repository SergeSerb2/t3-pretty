import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DRAFT_HERO_HANDOFF_MAX_AGE_MS,
  DRAFT_HERO_POP_MIN_TRAVEL_PX,
  DRAFT_HERO_TRANSITION_ANIMATION_ID,
  draftHeroGlideHasTravel,
  draftHeroGlideKeyframes,
  isDraftHeroAnimationPlaying,
  recordDraftHeroHandoff,
  runMobileComposerTransition,
  shouldGlideDraftHeroHandoff,
  shouldPopDraftHeroGlide,
  takeDraftHeroHandoff,
  waitForDraftHeroTransition,
} from "./draftHeroTransition";

afterEach(() => {
  vi.unstubAllGlobals();
  recordDraftHeroHandoff(null, 0);
});

describe("draft hero handoff across a ChatView remount", () => {
  it("hands the outgoing composer rect to the next mount exactly once", () => {
    recordDraftHeroHandoff({ left: 12, top: 640 }, 1000, { isDraftHero: true, gliding: false });
    expect(takeDraftHeroHandoff(1100)).toEqual({
      rect: { left: 12, top: 640 },
      isDraftHero: true,
      gliding: false,
    });
    expect(takeDraftHeroHandoff(1101)).toBeNull();
  });

  it("ignores a record older than the handoff window", () => {
    recordDraftHeroHandoff({ left: 12, top: 640 }, 1000);
    expect(takeDraftHeroHandoff(1000 + DRAFT_HERO_HANDOFF_MAX_AGE_MS + 1)).toBeNull();
  });

  it("clears the record when the outgoing view had no composer", () => {
    recordDraftHeroHandoff({ left: 12, top: 640 }, 1000);
    recordDraftHeroHandoff(null, 1050);
    expect(takeDraftHeroHandoff(1060)).toBeNull();
  });
});

describe("shouldGlideDraftHeroHandoff", () => {
  const dockedHandoff = {
    rect: { left: 12, top: 640 },
    isDraftHero: false,
    gliding: false,
  };

  it("glides a remount that crosses hero↔docked", () => {
    expect(
      shouldGlideDraftHeroHandoff({
        isDraftHero: true,
        handoff: dockedHandoff,
      }),
    ).toBe(true);
  });

  it("does not glide a settled docked→docked remount after the in-place dock", () => {
    expect(
      shouldGlideDraftHeroHandoff({
        isDraftHero: false,
        handoff: dockedHandoff,
      }),
    ).toBe(false);
  });

  it("continues a remount when the outgoing view was still gliding", () => {
    expect(
      shouldGlideDraftHeroHandoff({
        isDraftHero: false,
        handoff: { ...dockedHandoff, gliding: true },
      }),
    ).toBe(true);
  });
});

describe("shouldPopDraftHeroGlide", () => {
  it("pops only an in-place scenery dock with real vertical travel", () => {
    expect(
      shouldPopDraftHeroGlide({
        sceneryDock: true,
        inPlace: true,
        translateY: DRAFT_HERO_POP_MIN_TRAVEL_PX,
      }),
    ).toBe(true);
  });

  it("does not pop a promotion remount or a short correction", () => {
    expect(
      shouldPopDraftHeroGlide({
        sceneryDock: true,
        inPlace: false,
        translateY: DRAFT_HERO_POP_MIN_TRAVEL_PX,
      }),
    ).toBe(false);
    expect(
      shouldPopDraftHeroGlide({
        sceneryDock: true,
        inPlace: true,
        translateY: DRAFT_HERO_POP_MIN_TRAVEL_PX - 1,
      }),
    ).toBe(false);
  });
});

describe("draftHeroGlideKeyframes", () => {
  it("omits the scale pop unless the dock asked for it", () => {
    expect(draftHeroGlideHasTravel(0, 2)).toBe(true);
    expect(draftHeroGlideHasTravel(0, 0.4)).toBe(false);
    expect(draftHeroGlideKeyframes(0, 240, true)[0]?.transform).toContain("scale(1.02)");
    expect(draftHeroGlideKeyframes(0, 8, false)[0]?.transform).not.toContain("scale");
  });
});

describe("isDraftHeroAnimationPlaying", () => {
  it("treats running and paused as in-flight, finished as settled", () => {
    expect(isDraftHeroAnimationPlaying(null)).toBe(false);
    expect(isDraftHeroAnimationPlaying({ playState: "running" } as Animation)).toBe(true);
    expect(isDraftHeroAnimationPlaying({ playState: "paused" } as Animation)).toBe(true);
    expect(isDraftHeroAnimationPlaying({ playState: "finished" } as Animation)).toBe(false);
    expect(isDraftHeroAnimationPlaying({ playState: "idle" } as Animation)).toBe(false);
  });
});

describe("waitForDraftHeroTransition", () => {
  it("waits for active draft hero animations and ignores unrelated animations", async () => {
    let finishTransition: (() => void) | undefined;
    const transitionFinished = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    vi.stubGlobal("document", {
      getAnimations: () => [
        { id: "unrelated-animation", finished: new Promise<void>(() => undefined) },
        { id: DRAFT_HERO_TRANSITION_ANIMATION_ID, finished: transitionFinished },
      ],
    });

    let handoffComplete = false;
    const handoff = waitForDraftHeroTransition().then(() => {
      handoffComplete = true;
    });
    await Promise.resolve();
    expect(handoffComplete).toBe(false);

    finishTransition?.();
    await handoff;
    expect(handoffComplete).toBe(true);
  });

  it("allows the handoff when an active transition is cancelled", async () => {
    vi.stubGlobal("document", {
      getAnimations: () => [
        {
          id: DRAFT_HERO_TRANSITION_ANIMATION_ID,
          finished: Promise.reject(new Error("cancelled")),
        },
      ],
    });

    await expect(waitForDraftHeroTransition()).resolves.toBeUndefined();
  });
});

describe("runMobileComposerTransition", () => {
  it("keeps the route handoff waiting while the mobile composer morph is active", async () => {
    let finishTransition: (() => void) | undefined;
    const transitionFinished = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", {
      documentElement: { dataset },
      getAnimations: () => [],
      startViewTransition: (update: () => void | Promise<void>) => {
        void update();
        return { finished: transitionFinished };
      },
    });
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({ matches: query === "(max-width: 639px)" }),
    });

    const transition = runMobileComposerTransition(() => undefined);
    await Promise.resolve();

    let handoffComplete = false;
    const handoff = waitForDraftHeroTransition().then(() => {
      handoffComplete = true;
    });
    await Promise.resolve();
    expect(handoffComplete).toBe(false);

    finishTransition?.();
    await Promise.all([transition, handoff]);
    expect(handoffComplete).toBe(true);
  });

  it("uses a scoped view transition on mobile", async () => {
    const dataset: Record<string, string> = {};
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => ({
      finished: Promise.resolve(update()).then(() => undefined),
    }));
    vi.stubGlobal("document", {
      documentElement: { dataset },
      startViewTransition,
    });
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({ matches: query === "(max-width: 639px)" }),
    });
    const update = vi.fn();

    await runMobileComposerTransition(update);

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(dataset).not.toHaveProperty("mobileComposerRouteTransition");
  });

  it("updates without a view transition when reduced motion is preferred", async () => {
    const startViewTransition = vi.fn();
    vi.stubGlobal("document", {
      documentElement: { dataset: {} },
      startViewTransition,
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
    });
    const update = vi.fn();

    await runMobileComposerTransition(update);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });
});
