import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  canAnimateSceneryInkTransition,
  pinActiveChatTranscript,
  runSceneryInkTransition,
} from "./sceneryInkTransition";

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
      hidden: false,
      startViewTransition: () => ({ finished: Promise.resolve() }),
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    expect(canAnimateSceneryInkTransition()).toBe(true);
  });

  it("is false when the document is hidden", () => {
    vi.stubGlobal("document", {
      documentElement: { dataset: {} },
      hidden: true,
      startViewTransition: () => ({ finished: Promise.resolve() }),
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    expect(canAnimateSceneryInkTransition()).toBe(false);
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
    expect(update).toHaveBeenCalledWith(true);
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
    expect(update).toHaveBeenCalledWith(false);
  });

  it("reports not animating when the transition is skipped before its callback", async () => {
    vi.stubGlobal("document", {
      documentElement: { dataset: {} },
      // The callback never runs; finished rejects, so the update must land
      // through the fallback with animating=false.
      startViewTransition: () => ({ finished: Promise.reject(new Error("skipped")) }),
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });
    const update = vi.fn();

    runSceneryInkTransition(update);
    await Promise.resolve();
    await Promise.resolve();

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(false);
  });

  it("pins the first transcript before and after the view-transition update", () => {
    const first = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    const second = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    const querySelectorAll = vi.fn(() => [first, second]);
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      update();
      return { finished: Promise.resolve() };
    });
    vi.stubGlobal("document", {
      documentElement: { dataset: {} },
      hidden: false,
      querySelectorAll,
      startViewTransition,
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });

    runSceneryInkTransition(() => undefined);

    expect(querySelectorAll).toHaveBeenCalledTimes(2);
    expect(first.setAttribute).toHaveBeenCalledTimes(2);
    expect(first.setAttribute).toHaveBeenCalledWith("data-chat-transcript-active", "true");
    expect(second.removeAttribute).toHaveBeenCalledTimes(2);
    expect(second.removeAttribute).toHaveBeenCalledWith("data-chat-transcript-active");
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
    expect(update).toHaveBeenCalledWith(false);
    expect(dataset).not.toHaveProperty("sceneryInkTransition");
  });
});

describe("pinActiveChatTranscript", () => {
  it("keeps the name on the first transcript and clears cousins", () => {
    const first = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    const cousin = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    pinActiveChatTranscript({
      querySelectorAll: () => [first, cousin],
    });
    expect(first.setAttribute).toHaveBeenCalledWith("data-chat-transcript-active", "true");
    expect(cousin.removeAttribute).toHaveBeenCalledWith("data-chat-transcript-active");
    expect(cousin.setAttribute).not.toHaveBeenCalled();
  });
});
