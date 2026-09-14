import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SlidingActivity } from "./SlidingActivity";

let reducedMotion = false;
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => reducedMotion }));

function pendingAnimation() {
  let finish!: () => void;
  let reject!: () => void;
  const finished = new Promise<void>((resolve, rejectPromise) => {
    finish = resolve;
    reject = () => rejectPromise(new Error("cancelled"));
  });
  return { finished, finish, cancel: vi.fn(reject) };
}

let renderer: ReactTestRenderer | undefined;
let animations: ReturnType<typeof pendingAnimation>[];
let transform: string;
let inViewport: boolean;
let visibilityState: string;
let onIntersection: (entries: { isIntersecting: boolean }[]) => void;
const disconnect = vi.fn();
const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
  const animation = pendingAnimation();
  // Incoming animations have no completion callback in the component.
  void animation.finished.catch(() => {});
  animations.push(animation);
  return animation;
});

async function render(activityKey: string | null, label: string) {
  await act(() => {
    const content = (
      <SlidingActivity activityKey={activityKey}>
        <span>{label}</span>
      </SlidingActivity>
    );
    if (renderer) renderer.update(content);
    else {
      renderer = create(content, {
        createNodeMock: () => ({
          animate,
          getBoundingClientRect: () =>
            inViewport ? { top: 100, bottom: 128 } : { top: 900, bottom: 928 },
        }),
      });
    }
  });
}

function labels() {
  return renderer!.root.findAllByType("span").map((node) => node.children.join(""));
}

beforeEach(() => {
  reducedMotion = false;
  animations = [];
  transform = "none";
  inViewport = true;
  visibilityState = "visible";
  animate.mockClear();
  disconnect.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "document",
    Object.defineProperty(new EventTarget(), "visibilityState", { get: () => visibilityState }),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof onIntersection) {
        onIntersection = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.stubGlobal("window", { innerHeight: 800 });
  vi.stubGlobal("getComputedStyle", () => ({ transform, opacity: "1" }));
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("SlidingActivity", () => {
  it("keeps mount and same-call updates still, then departs with the latest label", async () => {
    await render("call-1", "Running command");
    await render("call-1", "Ran command");
    expect(animations).toHaveLength(0);
    await render("call-2", "Reading file");
    expect(labels()).toEqual(["Ran command", "Reading file"]);
    await act(() => animations[1]!.finish());
    expect(labels()).toEqual(["Reading file"]);
  });

  it("replaces a rapid handoff from its current position without retaining older rows", async () => {
    await render("call-1", "First");
    await render("call-2", "Second");
    const previousIntersection = onIntersection;
    transform = "matrix(1, 0, 0, 1, 0, 8)";
    await render("call-3", "Third");
    expect(labels()).toEqual(["Second", "Third"]);
    expect(animations[0]!.cancel).toHaveBeenCalled();
    expect(animations[1]!.cancel).toHaveBeenCalled();
    await act(() => previousIntersection([{ isIntersecting: false }]));
    expect(animations[2]!.cancel).not.toHaveBeenCalled();
    expect(animations[3]!.cancel).not.toHaveBeenCalled();
    expect(animate.mock.calls.at(-1)?.[0]).toEqual([
      { transform, opacity: "1" },
      { transform: "translateY(-45%)", opacity: 0 },
    ]);
    await act(() => animations[1]!.finish());
    expect(labels()).toEqual(["Second", "Third"]);
    await act(() => animations[3]!.finish());
    expect(labels()).toEqual(["Third"]);
  });

  it("clears an in-flight departure when reduced motion is enabled", async () => {
    await render("call-1", "First");
    await render("call-2", "Second");
    reducedMotion = true;
    await render("call-2", "Second");
    expect(labels()).toEqual(["Second"]);
    expect(animations.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);
    await render("call-3", "Third");
    expect(animations).toHaveLength(2);
  });

  it("does not replay a handoff after opening or closing the history", async () => {
    await render("call-1", "First");
    await render("call-2", "Second");
    await render(null, "Second");
    expect(labels()).toEqual(["Second"]);
    await render("call-3", "Third");
    expect(animations).toHaveLength(2);
  });

  it("skips background updates and cancels both layers on unmount", async () => {
    await render("call-1", "First");
    visibilityState = "hidden";
    await render("call-2", "Second");
    expect(animations).toHaveLength(0);
    visibilityState = "visible";
    await render("call-3", "Third");
    await act(() => renderer!.unmount());
    expect(animations.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);
  });

  it.each(["hidden", "offscreen"])(
    "retires an interrupted handoff when a replacement is %s without replaying stale content",
    async (reason) => {
      await render("call-1", "First");
      await render("call-2", "Second");
      if (reason === "hidden") visibilityState = "hidden";
      else inViewport = false;
      await render("call-3", "Third");
      expect(labels()).toEqual(["Third"]);
      expect(animations.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);
      visibilityState = "visible";
      inViewport = true;
      await render("call-3", "Third");
      expect(animations).toHaveLength(2);
      await render("call-4", "Fourth");
      expect(labels()).toEqual(["Third", "Fourth"]);
    },
  );

  it.each(["hidden", "offscreen"])(
    "retires both layers when becoming %s without another tool update",
    async (reason) => {
      await render("call-1", "First");
      await render("call-2", "Second");
      await act(() => {
        if (reason === "hidden") {
          visibilityState = "hidden";
          document.dispatchEvent(new Event("visibilitychange"));
        } else onIntersection([{ isIntersecting: false }]);
      });
      expect(labels()).toEqual(["Second"]);
      expect(animations.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);
      expect(disconnect).toHaveBeenCalled();
      visibilityState = "visible";
      await render("call-2", "Second");
      expect(animations).toHaveLength(2);
      await render("call-3", "Third");
      expect(labels()).toEqual(["Second", "Third"]);
    },
  );
});
