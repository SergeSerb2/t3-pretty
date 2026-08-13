import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createStreamingTextCadence, STREAMING_TEXT_CADENCE_MS } from "./streamingTextCadence";

afterEach(() => {
  vi.useRealTimers();
});

describe("createStreamingTextCadence", () => {
  it("coalesces growing text to the latest value in each cadence", () => {
    vi.useFakeTimers();
    let now = 0;
    const committed: string[] = [];
    const cadence = createStreamingTextCadence("a", (text) => committed.push(text), {
      now: () => now,
    });

    cadence.push("ab", true);
    now = 20;
    vi.advanceTimersByTime(20);
    cadence.push("abc", true);
    now = STREAMING_TEXT_CADENCE_MS;
    vi.advanceTimersByTime(STREAMING_TEXT_CADENCE_MS - 20);

    expect(committed).toEqual(["abc"]);
  });

  it("flushes exact settled text immediately and cancels the trailing update", () => {
    vi.useFakeTimers();
    let now = 0;
    const committed: string[] = [];
    const cadence = createStreamingTextCadence("a", (text) => committed.push(text), {
      now: () => now,
    });

    cadence.push("ab", true);
    now = 24;
    vi.advanceTimersByTime(24);
    cadence.push("final replacement", false);
    expect(committed).toEqual(["final replacement"]);

    now = 1_000;
    vi.advanceTimersByTime(1_000);
    expect(committed).toEqual(["final replacement"]);
  });

  it("commits immediately when the cadence has already elapsed", () => {
    let now = STREAMING_TEXT_CADENCE_MS;
    const committed: string[] = [];
    const cadence = createStreamingTextCadence("a", (text) => committed.push(text), {
      now: () => now,
    });

    now += STREAMING_TEXT_CADENCE_MS;
    cadence.push("ab", true);

    expect(committed).toEqual(["ab"]);
  });
});
