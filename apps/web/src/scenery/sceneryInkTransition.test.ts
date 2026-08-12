import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { canAnimateSceneryInkTransition, runSceneryInkTransition } from "./sceneryInkTransition";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canAnimateSceneryInkTransition", () => {
  it("is false when View Transitions are missing", () => {
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    expect(canAnimateSceneryInkTransition()).toBe(false);
  });

  it("is false when reduced motion is preferred", () => {
    vi.stubGlobal("document", {
      documentElement: { dataset: {} },
      startViewTransition: () => ({ finished: Promise.resolve() }),
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
    });
    expect(canAnimateSceneryInkTransition()).toBe(false);
  });

  it("is true when the API exists and motion is allowed", () => {
    vi.stubGlobal("document", {
      documentElement: { dataset: {} },
      startViewTransition: () => ({ finished: Promise.resolve() }),
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    expect(canAnimateSceneryInkTransition()).toBe(true);
  });
});

describe("runSceneryInkTransition", () => {
  it("uses a document view transition and clears the gate after it finishes", async () => {
    const dataset: Record<string, string> = {};
    let finishTransition: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      update();
      return { finished };
    });
    vi.stubGlobal("document", {
      documentElement: { dataset },
      startViewTransition,
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    const update = vi.fn();

    runSceneryInkTransition(update);

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(dataset.sceneryInkTransition).toBe("true");

    finishTransition?.();
    await finished;
    await Promise.resolve();
    expect(dataset).not.toHaveProperty("sceneryInkTransition");
  });

  it("updates without a view transition when reduced motion is preferred", () => {
    const startViewTransition = vi.fn();
    vi.stubGlobal("document", {
      documentElement: { dataset: {} },
      startViewTransition,
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
    });
    const update = vi.fn();

    runSceneryInkTransition(update);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });

  it("falls back to a direct update when startViewTransition throws", () => {
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", {
      documentElement: { dataset },
      startViewTransition: () => {
        throw new Error("already transitioning");
      },
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    const update = vi.fn();

    runSceneryInkTransition(update);

    expect(update).toHaveBeenCalledOnce();
    expect(dataset).not.toHaveProperty("sceneryInkTransition");
  });
});
