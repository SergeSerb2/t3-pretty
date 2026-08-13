import { describe, expect, it } from "vite-plus/test";

import { createKeyedPerformanceSampleGate } from "./performanceSampling";

describe("createKeyedPerformanceSampleGate", () => {
  it("allows one sample per key in each sampling window", () => {
    let now = 1_000;
    const shouldSample = createKeyedPerformanceSampleGate({ windowMs: 2_000, now: () => now });

    expect(shouldSample("environment-a:thread-a")).toBe(true);
    now = 2_999;
    expect(shouldSample("environment-a:thread-a")).toBe(false);
    now = 3_000;
    expect(shouldSample("environment-a:thread-a")).toBe(true);
  });

  it("samples different threads independently", () => {
    const shouldSample = createKeyedPerformanceSampleGate({ windowMs: 2_000, now: () => 1_000 });

    expect(shouldSample("environment-a:thread-a")).toBe(true);
    expect(shouldSample("environment-a:thread-b")).toBe(true);
    expect(shouldSample("environment-a:thread-a")).toBe(false);
  });

  it("evicts the oldest sampled key when the key budget is reached", () => {
    let now = 1_000;
    const shouldSample = createKeyedPerformanceSampleGate({
      windowMs: 10_000,
      maxKeys: 2,
      now: () => now,
    });

    expect(shouldSample("thread-a")).toBe(true);
    now += 1;
    expect(shouldSample("thread-b")).toBe(true);
    now += 1;
    expect(shouldSample("thread-c")).toBe(true);
    now += 1;
    expect(shouldSample("thread-a")).toBe(true);
  });
});
