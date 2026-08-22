import { afterEach, describe, expect, it } from "vite-plus/test";

import { resetMashGuard, shouldMashCut, sweepDirection } from "./themeSweep";

afterEach(() => {
  resetMashGuard();
});

describe("sweepDirection", () => {
  it("falls as dusk going dark and rises as dawn going light", () => {
    expect(sweepDirection(true)).toBe("dusk");
    expect(sweepDirection(false)).toBe("dawn");
  });
});

describe("shouldMashCut", () => {
  it("lets two sweeps animate, hard-cuts the burst, then recovers", () => {
    expect(shouldMashCut(0)).toBe(false);
    expect(shouldMashCut(200)).toBe(false);
    expect(shouldMashCut(400)).toBe(true);
    expect(shouldMashCut(600)).toBe(true);
    // The window is keyed to the recorded sweeps, not the rejected attempts,
    // so the animation comes back once the recorded burst ages out.
    expect(shouldMashCut(1300)).toBe(false);
  });

  it("never cuts a slow, considered toggle cadence", () => {
    expect(shouldMashCut(0)).toBe(false);
    expect(shouldMashCut(1100)).toBe(false);
    expect(shouldMashCut(2200)).toBe(false);
  });
});
