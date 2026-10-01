import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  LIVE_ACTIVITY_FRAME_MS,
  LIVE_ACTIVITY_PERIOD_MS,
  LIVE_ACTIVITY_PHASE_PROPERTY,
  observeLiveActivityMotion,
  registerLiveActivityClock,
} from "./liveActivityClock";

const listeners = new Map<string, () => void>();
const fakeDocument = {
  hidden: false,
  visibilityState: "visible" as DocumentVisibilityState,
  addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
  removeEventListener: (type: string, listener: () => void) => {
    if (listeners.get(type) === listener) listeners.delete(type);
  },
};

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  report(target: Element, isIntersecting: boolean): void {
    this.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function fakeElement(): HTMLElement {
  const properties = new Map<string, string>();
  return {
    style: {
      getPropertyValue: (name: string) => properties.get(name) ?? "",
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
  } as unknown as HTMLElement;
}

function phase(element: HTMLElement): string {
  return element.style.getPropertyValue(LIVE_ACTIVITY_PHASE_PROPERTY);
}

describe("live activity clock", () => {
  afterEach(() => {
    vi.useRealTimers();
    fakeDocument.hidden = false;
    fakeDocument.visibilityState = "visible";
    listeners.clear();
    FakeIntersectionObserver.instances = [];
    vi.unstubAllGlobals();
  });

  it("advances a visible row at the shared frame rate and stops with the last subscriber", () => {
    vi.stubGlobal("document", fakeDocument);
    vi.useFakeTimers();
    const element = fakeElement();
    element.style.setProperty("--visible-animation-state", "running");
    const release = registerLiveActivityClock(element);
    expect(phase(element)).toBe("0.0000");
    vi.advanceTimersByTime(LIVE_ACTIVITY_FRAME_MS);
    const moved = Number(phase(element));
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(1);

    vi.advanceTimersByTime(LIVE_ACTIVITY_PERIOD_MS);
    expect(Number(phase(element))).toBeGreaterThanOrEqual(0);
    expect(Number(phase(element))).toBeLessThan(1);

    release?.();
    const frozen = phase(element);
    expect(frozen).toBe("");
    vi.advanceTimersByTime(LIVE_ACTIVITY_FRAME_MS * 3);
    expect(phase(element)).toBe(frozen);
  });

  it("freezes while the document is hidden", () => {
    vi.stubGlobal("document", fakeDocument);
    vi.useFakeTimers();
    const element = fakeElement();
    element.style.setProperty("--visible-animation-state", "running");
    const release = registerLiveActivityClock(element);
    vi.advanceTimersByTime(LIVE_ACTIVITY_FRAME_MS);
    const running = phase(element);
    expect(running).not.toBe("");

    fakeDocument.hidden = true;
    listeners.get("visibilitychange")?.();
    vi.advanceTimersByTime(LIVE_ACTIVITY_FRAME_MS * 4);
    expect(phase(element)).toBe(running);

    fakeDocument.hidden = false;
    listeners.get("visibilitychange")?.();
    vi.advanceTimersByTime(LIVE_ACTIVITY_FRAME_MS);
    expect(phase(element)).not.toBe(running);
    release?.();
  });

  it("runs the clock only while a row is on screen", () => {
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("window", {
      matchMedia: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    vi.useFakeTimers();
    const element = fakeElement();
    const release = observeLiveActivityMotion(element);
    vi.advanceTimersByTime(LIVE_ACTIVITY_FRAME_MS * 4);
    expect(phase(element)).toBe("");

    FakeIntersectionObserver.instances[0]?.report(element, true);
    expect(phase(element)).toBe("0.0000");
    vi.advanceTimersByTime(LIVE_ACTIVITY_FRAME_MS);
    const running = phase(element);
    expect(Number(running)).toBeGreaterThan(0);

    FakeIntersectionObserver.instances[0]?.report(element, false);
    vi.advanceTimersByTime(LIVE_ACTIVITY_FRAME_MS * 4);
    expect(phase(element)).toBe(running);

    FakeIntersectionObserver.instances[0]?.report(element, true);
    vi.advanceTimersByTime(LIVE_ACTIVITY_FRAME_MS);
    expect(phase(element)).not.toBe(running);
    release?.();
  });

  it("shares one clock across rows and ignores a repeated release", () => {
    vi.stubGlobal("document", fakeDocument);
    vi.useFakeTimers();
    const first = fakeElement();
    const second = fakeElement();
    first.style.setProperty("--visible-animation-state", "running");
    second.style.setProperty("--visible-animation-state", "running");
    const releaseFirst = registerLiveActivityClock(first);
    const releaseSecond = registerLiveActivityClock(second);
    vi.advanceTimersByTime(LIVE_ACTIVITY_FRAME_MS);
    expect(phase(first)).toBe(phase(second));
    releaseFirst?.();
    releaseFirst?.();
    expect(phase(second)).not.toBe("");
    releaseSecond?.();
    expect(phase(second)).toBe("");
  });
});
