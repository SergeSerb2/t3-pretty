import { describe, expect, it } from "vite-plus/test";

import { shouldLeaveThreadOnSwipe } from "./thread-leave-swipe";

describe("shouldLeaveThreadOnSwipe", () => {
  it.each([
    ["a steady right swipe", 120, 8, 0, false, true],
    ["a short right flick", 30, 4, 900, false, true],
    ["a short slow drag", 30, 4, 100, false, false],
    ["a left swipe", -120, 8, -900, false, false],
    ["a vertical scroll", 30, 120, 900, false, false],
    ["a diagonal scroll after activation", 120, 100, 900, false, false],
    ["a drag reversed before release", 120, 8, -300, false, false],
    ["a drag returned to its start", 5, 0, 900, false, false],
    ["a cancelled long swipe", 120, 8, 900, true, false],
    ["a cancelled flick", 30, 4, 900, true, false],
  ])("handles %s", (_, translationX, translationY, velocityX, canceled, expected) => {
    expect(
      shouldLeaveThreadOnSwipe({ canceled, translationX, translationY, velocityX }, "release"),
    ).toBe(expected);
  });

  it.each([
    ["a slow deliberate drag at the commit point", 80, 8, 0, true],
    ["a fast deliberate drag", 90, 8, 900, true],
    ["a drag below the commit point", 79, 8, 100, false],
    ["a short flick that has not finished", 30, 4, 900, false],
    ["a vertical drag", 30, 120, 900, false],
    ["a diagonal drag", 90, 60, 900, false],
    ["a reversed drag", 90, 8, -300, false],
    ["a left drag", -90, 8, -900, false],
  ])("commits %s before release", (_, translationX, translationY, velocityX, expected) => {
    expect(shouldLeaveThreadOnSwipe({ translationX, translationY, velocityX }, "drag")).toBe(
      expected,
    );
  });

  it("lets a short swipe cancel before it crosses the commit point", () => {
    const swipe = { translationX: 30, translationY: 4, velocityX: 900 };
    expect(shouldLeaveThreadOnSwipe(swipe, "drag")).toBe(false);
    expect(shouldLeaveThreadOnSwipe({ ...swipe, canceled: true }, "release")).toBe(false);
    expect(shouldLeaveThreadOnSwipe({ ...swipe, canceled: false }, "release")).toBe(true);
  });
});
