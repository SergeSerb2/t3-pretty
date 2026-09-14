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
          getBoundingClientRect: () => ({ top: 100, bottom: 128 }),
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
  animate.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { visibilityState: "visible" });
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
    transform = "matrix(1, 0, 0, 1, 0, 8)";
    await render("call-3", "Third");
    expect(labels()).toEqual(["Second", "Third"]);
    expect(animations[0]!.cancel).toHaveBeenCalled();
    expect(animations[1]!.cancel).toHaveBeenCalled();
    expect(animate.mock.calls.at(-1)?.[0]).toEqual([
      { transform, opacity: "1" },
      { transform: "translateY(-100%)", opacity: 0 },
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
    vi.stubGlobal("document", { visibilityState: "hidden" });
    await render("call-2", "Second");
    expect(animations).toHaveLength(0);
    vi.stubGlobal("document", { visibilityState: "visible" });
    await render("call-3", "Third");
    await act(() => renderer!.unmount());
    expect(animations.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);
  });
});
