// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipScrollDismissArea,
  TooltipTrigger,
} from "./tooltip";

let root: Root;
let container: HTMLDivElement;

function hover(trigger: Element) {
  trigger.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }),
  );
  trigger.dispatchEvent(new MouseEvent("mouseenter", { relatedTarget: document.body }));
}

const openPopup = () => document.querySelector('[data-slot="tooltip-popup"][data-open]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("tooltip content work", () => {
  it("opens a rich hover card without cloning its content tree", async () => {
    const clone = vi.spyOn(Node.prototype, "cloneNode");
    await act(async () => {
      root.render(
        <Tooltip>
          <TooltipTrigger delay={0}>Thread</TooltipTrigger>
          <TooltipPopup>
            <div>
              {Array.from({ length: 20 }, (_, index) => (
                <span key={index}>Thread metadata {index}</span>
              ))}
            </div>
          </TooltipPopup>
        </Tooltip>,
      );
    });
    await act(async () => {
      hover(container.querySelector("button")!);
    });

    expect(document.querySelector('[data-slot="tooltip-popup"]')?.textContent).toContain(
      "Thread metadata 19",
    );
    expect(clone).not.toHaveBeenCalled();
  });

  it("updates live content without remounting the visible card", async () => {
    const render = (status: string) => (
      <Tooltip defaultOpen defaultTriggerId="connection">
        <TooltipTrigger id="connection" payload={status}>
          Connection
        </TooltipTrigger>
        <TooltipPopup>
          <span>{status}</span>
        </TooltipPopup>
      </Tooltip>
    );
    await act(async () => root.render(render("Connecting")));
    const content = document.querySelector('[data-slot="tooltip-popup"] span');
    expect(content?.textContent).toBe("Connecting");

    await act(async () => root.render(render("Connected")));
    expect(document.querySelector('[data-slot="tooltip-popup"] span')).toBe(content);
    expect(content?.textContent).toBe("Connected");
  });

  it("switches grouped hover cards and dismisses them on scroll", async () => {
    await act(async () =>
      root.render(
        <TooltipProvider delay={0}>
          <TooltipScrollDismissArea>
            {["First", "Second"].map((label) => (
              <Tooltip key={label}>
                <TooltipTrigger>{label}</TooltipTrigger>
                <TooltipPopup>{label} details</TooltipPopup>
              </Tooltip>
            ))}
          </TooltipScrollDismissArea>
        </TooltipProvider>,
      ),
    );
    const triggers = container.querySelectorAll("button");
    await act(async () => hover(triggers[0]!));
    expect(openPopup()?.textContent).toBe("First details");
    await act(async () => hover(triggers[1]!));
    expect(document.querySelectorAll('[data-slot="tooltip-popup"][data-open]')).toHaveLength(1);
    expect(openPopup()?.textContent).toBe("Second details");

    await act(async () => container.firstElementChild!.dispatchEvent(new Event("scroll")));
    expect(openPopup()).toBeNull();
  });

  it("keeps focused details on scroll and closes them with Escape", async () => {
    await act(async () =>
      root.render(
        <TooltipScrollDismissArea>
          <Tooltip>
            <TooltipTrigger delay={0}>Thread</TooltipTrigger>
            <TooltipPopup>Thread details</TooltipPopup>
          </Tooltip>
        </TooltipScrollDismissArea>,
      ),
    );
    const trigger = container.querySelector("button")!;
    await act(async () => {
      hover(trigger);
      trigger.focus();
    });
    await act(async () => container.firstElementChild!.dispatchEvent(new Event("scroll")));
    expect(openPopup()?.textContent).toBe("Thread details");
    await act(async () =>
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(openPopup()).toBeNull();
  });
});
