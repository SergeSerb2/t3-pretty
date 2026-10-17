// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useSidebarPeekPointerBinding } from "./sidebarPeek";

let root: Root;
let container: HTMLDivElement;
const leave = vi.fn();

function PeekSurfaces() {
  const binding = useSidebarPeekPointerBinding(() => {}, leave);
  return (
    <div data-slot="sidebar-wrapper">
      <div data-slot="sidebar-container" {...binding}>
        <button>Thread</button>
        <div data-sidebar-peek-hover-bridge />
      </div>
      <button data-sidebar-control>Toggle sidebar</button>
    </div>
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  leave.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<PeekSurfaces />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sidebar peek pointer measurements", () => {
  it("crosses to the sidebar control without measuring and still closes after leaving it", async () => {
    const measure = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 300, 800));
    const sidebar = container.querySelector('[data-slot="sidebar-container"]')!;
    const control = container.querySelector("[data-sidebar-control]")!;
    await act(async () => {
      sidebar.dispatchEvent(
        new MouseEvent("pointerout", {
          bubbles: true,
          relatedTarget: control,
        }),
      );
    });
    control.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 30, clientY: 100 }),
    );
    expect(leave).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, clientY: 100 }));
    expect(leave).toHaveBeenCalledOnce();
    expect(measure).toHaveBeenCalled();

    measure.mockClear();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 600, clientY: 100 }));
    expect(leave).toHaveBeenCalledOnce();
    expect(measure).not.toHaveBeenCalled();
  });

  it("uses the pointer target inside a held peek and measures only when it moves outside", async () => {
    const measure = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 300, 800));
    const sidebar = container.querySelector('[data-slot="sidebar-container"]')!;
    await act(async () => {
      sidebar.dispatchEvent(
        new MouseEvent("pointerout", {
          bubbles: true,
          clientX: 30,
          clientY: 100,
        }),
      );
    });
    measure.mockClear();
    const thread = sidebar.querySelector("button")!;
    for (let index = 0; index < 100; index++) {
      thread.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 30,
          clientY: 100 + index,
        }),
      );
    }
    expect(leave).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, clientY: 100 }));
    expect(measure).toHaveBeenCalled();
    expect(leave).toHaveBeenCalledOnce();
  });
});
