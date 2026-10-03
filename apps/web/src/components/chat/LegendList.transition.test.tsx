import { createRequire } from "node:module";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

// The default unit environment is Node. Install a DOM locally so the shared
// Node setup stays intact and this test exercises the real web virtualizer.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options: { pretendToBeVisual: boolean },
  ) => {
    window: Window & typeof globalThis;
  };
};
type Row = { id: string; text: string; streaming?: boolean };
const ROW_HEIGHT = 72;
const VIEWPORT_HEIGHT = 360;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  for (const name of [
    "window",
    "document",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "navigator",
    "getComputedStyle",
  ] as const) {
    vi.stubGlobal(name, dom.window[name]);
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, contentRect: target.getBoundingClientRect() }] as ResizeObserverEntry[],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  // JSDOM has no layout engine. Supply a fixed viewport and fixed row heights;
  // LegendList owns the actual ranges, item positions, and scroll transitions.
  const measuredHeight = (element: HTMLElement) =>
    element.classList.contains("messages-timeline-scroll") ? VIEWPORT_HEIGHT : ROW_HEIGHT;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const height = measuredHeight(this);
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: height,
      width: 800,
      height,
      toJSON() {
        return {};
      },
    };
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return measuredHeight(this);
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return measuredHeight(this);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? (y ?? 0) : (options?.top ?? this.scrollTop);
  };
  HTMLElement.prototype.scrollBy = function (options?: ScrollToOptions | number, y?: number) {
    this.scrollTop += typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeTimeline() {
  const ref = createRef<LegendListRef>();
  const render = async (rows: Row[], identity: string, followEnd = true) => {
    await act(async () => {
      root.render(
        <LegendList<Row>
          ref={ref}
          data={rows}
          dataVersion={identity}
          dataKey={identity}
          initialScrollAtEnd={followEnd}
          estimatedItemSize={ROW_HEIGHT}
          maintainScrollAtEnd={
            followEnd ? { on: { dataChange: true, itemLayout: true, layout: true } } : false
          }
          maintainVisibleContentPosition={{ data: true, size: true }}
          recycleItems={false}
          className="messages-timeline-scroll"
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => <div data-row-id={item.id}>{item.text}</div>}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  };
  const restoreIndex = async (index: number) => {
    await act(async () => {
      void ref.current?.scrollToIndex({ index, animated: false });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  };
  return { ref, render, restoreIndex };
}

it("renders long and short threads and restores a reopened history anchor", async () => {
  const timeline = makeTimeline();
  const oldRows = Array.from({ length: 120 }, (_, index) => ({
    id: `history-${index}`,
    text: `old-${index}`,
  }));
  const shortRows = [
    { id: "user", text: "new prompt" },
    { id: "assistant", text: "new response" },
  ];
  await timeline.render(oldRows, "old-thread");
  expect(timeline.ref.current?.getState().contentLength).toBeGreaterThan(VIEWPORT_HEIGHT);
  expect(timeline.ref.current?.getState().scroll).toBeGreaterThan(VIEWPORT_HEIGHT);
  expect(container.textContent).toContain("old-119");

  await timeline.render(shortRows, "new-thread");
  expect(container.textContent).toContain("new prompt");
  expect(container.textContent).toContain("new response");
  expect(timeline.ref.current?.getState().start).toBe(0);
  expect(timeline.ref.current?.getState().end).toBe(1);
  expect(timeline.ref.current?.getState().scroll).toBeLessThanOrEqual(VIEWPORT_HEIGHT);

  // A saved reader position opts out of end pinning; the thread's restoration
  // controller can then scroll to the same durable row after a fresh identity.
  await timeline.render(oldRows, "old-thread", false);
  await timeline.restoreIndex(40);
  expect(container.querySelector('[data-row-id="history-40"]')?.textContent).toBe("old-40");
  expect(timeline.ref.current?.getState().start).toBe(40);
  const rememberedScroll = timeline.ref.current?.getState().scroll;
  await timeline.render(shortRows, "new-thread");
  await timeline.render(oldRows, "old-thread", false);
  await timeline.restoreIndex(40);
  expect(timeline.ref.current?.getState().scroll).toBe(rememberedScroll);
  expect(container.querySelector('[data-row-id="history-40"]')?.textContent).toBe("old-40");

  // Paging older history on the same thread must preserve the visible row,
  // despite its numeric index moving by the number of prepended messages.
  const earlierRows = Array.from({ length: 20 }, (_, index) => ({
    id: `earlier-${index}`,
    text: `earlier-${index}`,
  }));
  await timeline.render([...earlierRows, ...oldRows], "old-thread", false);
  expect(container.querySelector('[data-row-id="history-40"]')?.textContent).toBe("old-40");
  expect(timeline.ref.current?.getState().indexByKey("history-40")).toBe(60);
  expect(timeline.ref.current?.getState().start).toBe(60);
});

it("renders a new thread's first prompt and updates a streaming message without replacing its row", async () => {
  const timeline = makeTimeline();
  await timeline.render([], "brand-new-thread");
  expect(container.textContent).toBe("");
  const user: Row = { id: "first-user", text: "first prompt" };
  await timeline.render([user], "brand-new-thread");
  expect(container.textContent).toContain("first prompt");
  const userElement = container.querySelector('[data-row-id="first-user"]');
  const assistant: Row = { id: "first-assistant", text: "Hello", streaming: true };
  await timeline.render([user, assistant], "brand-new-thread");
  const assistantElement = container.querySelector('[data-row-id="first-assistant"]');
  expect(assistantElement?.textContent).toBe("Hello");
  expect(container.querySelector('[data-row-id="first-user"]')).toBe(userElement);

  for (const text of ["Hello from", "Hello from the agent"]) {
    await timeline.render([user, { ...assistant, text }], "brand-new-thread");
    expect(container.querySelector('[data-row-id="first-assistant"]')).toBe(assistantElement);
    expect(assistantElement?.textContent).toBe(text);
    expect(container.textContent).toContain("first prompt");
  }
  await timeline.render(
    [user, { ...assistant, text: "Hello from the agent. Done.", streaming: false }],
    "brand-new-thread",
  );
  expect(container.querySelector('[data-row-id="first-assistant"]')).toBe(assistantElement);
  expect(assistantElement?.textContent).toBe("Hello from the agent. Done.");
  expect(timeline.ref.current?.getState().start).toBe(0);
  expect(timeline.ref.current?.getState().end).toBe(1);
});
