// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ComposerSpecular } from "./ComposerSpecular";

let root: Root;
let container: HTMLDivElement;
const pointerMotion = { matches: true };

function pointer(
  target: Element,
  type: string,
  x: number,
  timeStamp: number,
  relatedTarget: Element | null = null,
) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 20, relatedTarget });
  Object.defineProperties(event, {
    pointerType: { value: "mouse" },
    timeStamp: { value: timeStamp },
  });
  target.dispatchEvent(event);
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pointerMotion.matches = true;
  vi.stubGlobal("matchMedia", () => pointerMotion);
  document.documentElement.setAttribute("data-scenery-motion", "");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <>
        <aside>Sidebar</aside>
        <div data-composer>
          <ComposerSpecular />
        </div>
      </>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.removeAttribute("data-scenery-motion");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("composer pointer work", () => {
  it("does not invalidate composer styles or schedule work while hovering the sidebar", () => {
    const styles = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
    const timer = vi.spyOn(window, "setTimeout");
    const frame = vi.spyOn(window, "requestAnimationFrame");
    const sidebar = container.querySelector("aside")!;
    for (let index = 0; index < 100; index++) {
      pointer(sidebar, "pointermove", (index % 7) * 13, 1000 + index * 8);
    }
    expect(styles).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
  });

  it("uses approach speed on entry and handles each boundary crossing once", () => {
    const sidebar = container.querySelector("aside")!;
    const composer = container.querySelector<HTMLElement>("[data-composer]")!;
    pointer(sidebar, "pointermove", 0, 1000);
    pointer(sidebar, "pointermove", 80, 1016);
    const frame = vi.spyOn(window, "requestAnimationFrame");
    const styles = vi.spyOn(composer.style, "setProperty");
    pointer(sidebar, "pointerout", 160, 1032, composer);
    pointer(composer, "pointerover", 160, 1032, sidebar);
    expect(Number(composer.style.getPropertyValue("--composer-hover-in"))).toBeLessThan(1);
    expect(styles.mock.calls.filter(([name]) => name === "--composer-hover-in")).toHaveLength(1);
    expect(frame).toHaveBeenCalledTimes(1);
  });

  it("coalesces movement and skips a queued paint after leaving the composer", () => {
    let paint: FrameRequestCallback | undefined;
    const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      paint = callback;
      return 1;
    });
    const composer = container.querySelector<HTMLElement>("[data-composer]")!;
    const sidebar = container.querySelector("aside")!;
    pointer(composer, "pointerover", 30, 1000, sidebar);
    pointer(composer, "pointermove", 40, 1008);
    pointer(composer, "pointermove", 50, 1016);
    expect(frame).toHaveBeenCalledTimes(1);
    pointer(composer, "pointerout", 60, 1024, sidebar);
    const measure = vi.spyOn(composer, "getBoundingClientRect");
    const styles = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
    paint?.(1032);
    expect(measure).not.toHaveBeenCalled();
    expect(styles).not.toHaveBeenCalled();
  });

  it.each(["motion-off", "reduced-motion"])("does no hover work with %s", (mode) => {
    if (mode === "motion-off") document.documentElement.removeAttribute("data-scenery-motion");
    else pointerMotion.matches = false;
    const composer = container.querySelector("[data-composer]")!;
    const styles = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
    const frame = vi.spyOn(window, "requestAnimationFrame");
    pointer(composer, "pointerover", 30, 1000, container.querySelector("aside"));
    pointer(composer, "pointermove", 40, 1008);
    expect(styles).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
  });
});
