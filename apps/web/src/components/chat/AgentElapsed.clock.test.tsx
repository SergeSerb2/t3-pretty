import * as NodeModule from "node:module";
import { act, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { AgentElapsed } from "./AgentElapsed";

const { JSDOM } = NodeModule.createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis };
};

it("updates many agent labels without React commits or hidden-window timers", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  for (const name of ["window", "document", "HTMLElement", "Event"] as const) {
    vi.stubGlobal(name, dom.window[name]);
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const committed = vi.fn();
  const agent = {
    status: "running" as const,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  try {
    await act(async () => {
      root.render(
        <Profiler id="elapsed" onRender={committed}>
          {Array.from({ length: 128 }, (_, index) => (
            <AgentElapsed key={index} agent={agent} />
          ))}
        </Profiler>,
      );
    });
    const mountCommits = committed.mock.calls.length;
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(3_000));
    for (const label of container.querySelectorAll("span")) expect(label.textContent).toBe("3s");
    expect(committed).toHaveBeenCalledTimes(mountCommits);

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(10_000));
    for (const label of container.querySelectorAll("span")) expect(label.textContent).toBe("3s");
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    for (const label of container.querySelectorAll("span")) expect(label.textContent).toBe("13s");
    expect(committed).toHaveBeenCalledTimes(mountCommits);
  } finally {
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
