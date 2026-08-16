import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { useMotionStore } from "~/scenery/motionStore";

import {
  STATUS_PULSE_ATTRIBUTE,
  STATUS_PULSE_TICK_MS,
  subscribeStatusPulse,
} from "./useStatusPulse";

const listeners = new Map<string, () => void>();
const attributes = new Map<string, string>();
const fakeDocument = {
  hidden: false,
  documentElement: {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  },
  addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
};

const phase = () => attributes.get(STATUS_PULSE_ATTRIBUTE);

describe("status pulse ticker", () => {
  beforeAll(() => {
    vi.stubGlobal("document", fakeDocument);
  });
  afterEach(() => {
    vi.useRealTimers();
    fakeDocument.hidden = false;
    useMotionStore.setState({ enabled: true });
  });

  it("starts on the first subscriber and stops on the last", () => {
    vi.useFakeTimers();
    expect(phase()).toBeUndefined();
    const releaseA = subscribeStatusPulse();
    const releaseB = subscribeStatusPulse();
    const initial = phase();
    expect(initial).toBeDefined();
    vi.advanceTimersByTime(STATUS_PULSE_TICK_MS);
    expect(phase()).not.toBe(initial);
    releaseA();
    releaseA(); // double release is a no-op
    expect(phase()).toBeDefined();
    releaseB();
    expect(phase()).toBeUndefined();
    const before = attributes.size;
    vi.advanceTimersByTime(STATUS_PULSE_TICK_MS * 3);
    expect(attributes.size).toBe(before);
  });

  it("pauses while the document is hidden and resumes when visible", () => {
    vi.useFakeTimers();
    const release = subscribeStatusPulse();
    expect(phase()).toBeDefined();
    fakeDocument.hidden = true;
    listeners.get("visibilitychange")?.();
    expect(phase()).toBeUndefined();
    fakeDocument.hidden = false;
    listeners.get("visibilitychange")?.();
    expect(phase()).toBeDefined();
    release();
  });

  it("stays static while the Motion toggle is off", () => {
    vi.useFakeTimers();
    useMotionStore.setState({ enabled: false });
    const release = subscribeStatusPulse();
    expect(phase()).toBeUndefined();
    useMotionStore.setState({ enabled: true });
    expect(phase()).toBeDefined();
    release();
    expect(phase()).toBeUndefined();
  });
});
