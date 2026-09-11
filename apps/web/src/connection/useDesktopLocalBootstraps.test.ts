import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createDesktopLocalBootstrapsStore } from "./useDesktopLocalBootstraps";

const POLL_INTERVAL_MS = 2_000;

function makeBootstrap(
  overrides: Partial<DesktopEnvironmentBootstrap> = {},
): DesktopEnvironmentBootstrap {
  return {
    id: "wsl:Ubuntu",
    label: "WSL: Ubuntu",
    runningDistro: "Ubuntu",
    httpBaseUrl: "http://127.0.0.1:4000",
    wsBaseUrl: "ws://127.0.0.1:4000",
    ...overrides,
  };
}

function makeVisibilityHarness(initiallyVisible = true) {
  const listeners = new Set<() => void>();
  let visible = initiallyVisible;

  return {
    isVisible: () => visible,
    subscribeVisibility: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setVisible: (nextVisible: boolean) => {
      visible = nextVisible;
      for (const listener of listeners) {
        listener();
      }
    },
    listenerCount: () => listeners.size,
  };
}

describe("desktop local bootstraps store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one poll and preserves snapshot identity for equivalent topology", () => {
    const visibility = makeVisibilityHarness();
    let topology = [makeBootstrap()];
    const read = vi.fn(() => topology.map((entry) => ({ ...entry })));
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const store = createDesktopLocalBootstrapsStore({
      read,
      isVisible: visibility.isVisible,
      subscribeVisibility: visibility.subscribeVisibility,
      pollIntervalMs: POLL_INTERVAL_MS,
    });
    const initialSnapshot = store.getSnapshot();
    expect(initialSnapshot).toEqual(topology);
    expect(read).toHaveBeenCalledTimes(1);

    const unsubscribeFirst = store.subscribe(firstListener);
    const firstSnapshot = store.getSnapshot();
    expect(firstSnapshot).toBe(initialSnapshot);
    expect(read).toHaveBeenCalledTimes(2);
    expect(firstListener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    const unsubscribeSecond = store.subscribe(secondListener);
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot()).toBe(firstSnapshot);
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();

    topology = [makeBootstrap({ label: "Ubuntu on WSL" })];
    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(store.getSnapshot()).not.toBe(firstSnapshot);
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    expect(vi.getTimerCount()).toBe(1);
    unsubscribeSecond();
    expect(vi.getTimerCount()).toBe(0);
    expect(visibility.listenerCount()).toBe(0);
  });

  it("pauses while hidden and refreshes immediately when visible again", () => {
    const visibility = makeVisibilityHarness();
    let topology = [makeBootstrap()];
    const read = vi.fn(() => topology);
    const listener = vi.fn();
    const store = createDesktopLocalBootstrapsStore({
      read,
      isVisible: visibility.isVisible,
      subscribeVisibility: visibility.subscribeVisibility,
      pollIntervalMs: POLL_INTERVAL_MS,
    });
    expect(store.getSnapshot()).toBe(topology);
    expect(read).toHaveBeenCalledTimes(1);

    const unsubscribe = store.subscribe(listener);
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    visibility.setVisible(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
    expect(read).toHaveBeenCalledTimes(2);

    topology = [makeBootstrap({ wsBaseUrl: "ws://127.0.0.1:5000" })];
    visibility.setVisible(true);
    expect(read).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(topology);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(4);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes async source changes immediately and detaches with the last subscriber", () => {
    const visibility = makeVisibilityHarness();
    const initial = [makeBootstrap()];
    let sourceListener:
      | ((bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>) => void)
      | undefined;
    const detachSource = vi.fn();
    const listener = vi.fn();
    const store = createDesktopLocalBootstrapsStore({
      read: () => initial,
      isVisible: visibility.isVisible,
      subscribeVisibility: visibility.subscribeVisibility,
      subscribeSource: (nextListener) => {
        sourceListener = nextListener;
        return detachSource;
      },
      pollIntervalMs: POLL_INTERVAL_MS,
    });

    expect(store.getSnapshot()).toBe(initial);
    const unsubscribe = store.subscribe(listener);
    const updated = [makeBootstrap({ label: "Ubuntu on WSL" })];
    sourceListener?.(updated);

    expect(store.getSnapshot()).toBe(updated);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(detachSource).toHaveBeenCalledTimes(1);
  });
});
