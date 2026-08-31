import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("react");
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("useNowMinute", () => {
  it("does not leave an interval behind when the last listener leaves during a tick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:59.999Z"));

    let subscribe: ((listener: () => void) => () => void) | undefined;
    vi.doMock("react", () => ({
      useSyncExternalStore: (
        nextSubscribe: (listener: () => void) => () => void,
        getSnapshot: () => string,
      ) => {
        subscribe = nextSubscribe;
        return getSnapshot();
      },
    }));
    vi.stubGlobal("window", {
      clearInterval: globalThis.clearInterval,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      setTimeout: globalThis.setTimeout,
    });

    const { useNowMinute } = await import("./useNowMinute");
    useNowMinute();

    let unsubscribe = () => {};
    unsubscribe = subscribe?.(() => unsubscribe()) ?? unsubscribe;
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1);

    expect(vi.getTimerCount()).toBe(0);
  });
});
