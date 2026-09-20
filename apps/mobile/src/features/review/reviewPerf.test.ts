import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { markReviewEvent, measureReviewAsyncWork, measureReviewWork } from "./reviewPerf";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installPerformanceRecorder() {
  let now = 0;
  const performance = {
    clearMarks: vi.fn(),
    clearMeasures: vi.fn(),
    mark: vi.fn(),
    measure: vi.fn(),
    now: vi.fn(() => (now += 1)),
  };
  vi.stubGlobal("__DEV__", true);
  vi.stubGlobal("performance", performance);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  return performance;
}

describe("review performance measurements", () => {
  it("clears a synchronous measurement after reporting it", () => {
    const performance = installPerformanceRecorder();

    expect(measureReviewWork("parse", () => "done")).toBe("done");

    expect(performance.measure).toHaveBeenCalledWith(
      "t3.review.parse",
      expect.stringMatching(/\.start$/),
      expect.stringMatching(/\.end$/),
    );
    expect(performance.clearMeasures).toHaveBeenCalledWith("t3.review.parse");
  });

  it("clears an asynchronous measurement after reporting it", async () => {
    const performance = installPerformanceRecorder();

    await expect(measureReviewAsyncWork("highlight", async () => "done")).resolves.toBe("done");

    expect(performance.clearMeasures).toHaveBeenCalledWith("t3.review.highlight");
  });

  it("clears a standalone event mark after reporting it", () => {
    const performance = installPerformanceRecorder();

    markReviewEvent("parsed-diff-ready", { files: 3 });

    expect(performance.mark).toHaveBeenCalledWith("t3.review.parsed-diff-ready");
    expect(performance.clearMarks).toHaveBeenCalledWith("t3.review.parsed-diff-ready");
  });
});
