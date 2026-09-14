import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ActivityLabel } from "./ActivityLabel";

let reducedMotion = false;
let visible = true;
let onIntersection: (entries: { isIntersecting: boolean }[]) => void;
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => reducedMotion }));
const cancel = vi.fn();
const disconnect = vi.fn();
const animate = vi.fn(() => ({ cancel, finished: new Promise<void>(() => {}) }));
let renderer: ReactTestRenderer | undefined;

async function render(activityKey: string, headline: string | null) {
  await act(() => {
    const content = (
      <ActivityLabel activityKey={activityKey} headline={headline} className="truncate">
        {headline ?? "Running command"}
      </ActivityLabel>
    );
    if (renderer) renderer.update(content);
    else
      renderer = create(content, {
        createNodeMock: () => ({ animate }),
      });
  });
}

async function becomeVisible() {
  await act(() => {
    onIntersection([{ isIntersecting: true }]);
  });
}

beforeEach(() => {
  reducedMotion = false;
  visible = true;
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "document",
    Object.defineProperty(new EventTarget(), "visibilityState", {
      get: () => (visible ? "visible" : "hidden"),
    }),
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
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("ActivityLabel", () => {
  it("reveals a generated replacement once while exposing the complete text", async () => {
    await render("call-1", null);
    expect(animate).not.toHaveBeenCalled();
    await render("call-1", "Checking the sidebar layout");
    expect(animate).not.toHaveBeenCalled();
    await becomeVisible();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findByType("span").children).toEqual(["Checking the sidebar layout"]);
    await render("call-1", "Checking the sidebar layout");
    expect(animate).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("does not replay an existing headline on mount or during a new action's handoff", async () => {
    await render("call-1", "Checking layout");
    await render("call-2", "Reading styles");
    expect(animate).not.toHaveBeenCalled();
  });

  it("cancels an interrupted reveal before revealing the latest description", async () => {
    await render("call-1", null);
    await render("call-1", "Checking layout");
    await becomeVisible();
    await render("call-1", "Checking compact navigation");
    await becomeVisible();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(2);
    await render("call-2", null);
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("shows replacements immediately with reduced motion or in a background tab", async () => {
    await render("call-1", null);
    reducedMotion = true;
    await render("call-1", "Checking layout");
    reducedMotion = false;
    visible = false;
    await render("call-1", "Reading styles");
    expect(animate).not.toHaveBeenCalled();
    visible = true;
    await render("call-1", "Reading styles");
    expect(animate).not.toHaveBeenCalled();
  });

  it.each(["hidden", "offscreen"])(
    "retires the reveal when %s without another label update",
    async (reason) => {
      await render("call-1", null);
      await render("call-1", "Checking layout");
      await becomeVisible();
      if (reason === "hidden") {
        visible = false;
        document.dispatchEvent(new Event("visibilitychange"));
      } else onIntersection([{ isIntersecting: false }]);
      expect(cancel).toHaveBeenCalled();
      expect(disconnect).toHaveBeenCalled();
    },
  );
});
