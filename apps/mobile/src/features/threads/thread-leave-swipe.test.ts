import { describe, expect, it } from "vite-plus/test";

import { shouldLeaveThreadOnSwipe } from "./thread-leave-swipe";

describe("shouldLeaveThreadOnSwipe", () => {
  it.each([
    ["a steady left swipe", -120, 8, 0, false, true],
    ["a short left flick", -30, 4, -900, false, true],
    ["a short slow drag", -30, 4, -100, false, false],
    ["a right swipe", 120, 8, 900, false, false],
    ["a vertical scroll", -30, 120, -900, false, false],
    ["a diagonal scroll after activation", -120, 100, -900, false, false],
    ["a drag reversed before release", -120, 8, 300, false, false],
    ["a drag returned to its start", -5, 0, -900, false, false],
    ["a cancelled long swipe", -120, 8, -900, true, false],
    ["a cancelled flick", -30, 4, -900, true, false],
  ])("handles %s", (_, translationX, translationY, velocityX, canceled, expected) => {
    expect(shouldLeaveThreadOnSwipe({ canceled, translationX, translationY, velocityX })).toBe(
      expected,
    );
  });
});
