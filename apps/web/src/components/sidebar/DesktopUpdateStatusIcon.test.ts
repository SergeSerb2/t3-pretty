import { describe, expect, it } from "vite-plus/test";

import {
  DESKTOP_UPDATE_CHECK_SETTLE_ANIMATION_NAME,
  desktopUpdateCheckMotionAfterSpinIteration,
  desktopUpdateCheckSpinFrom,
  isDesktopUpdateCheckSettleAnimationEnd,
  shouldClearDesktopUpdateCheckSettle,
} from "./DesktopUpdateStatusIcon";

describe("desktopUpdateCheckMotionAfterSpinIteration", () => {
  it("keeps spinning while the check is still running", () => {
    expect(
      desktopUpdateCheckMotionAfterSpinIteration({
        isChecking: true,
        prefersReducedMotion: false,
      }),
    ).toBe("spin");
  });

  it("settles past rest after the check finishes", () => {
    expect(
      desktopUpdateCheckMotionAfterSpinIteration({
        isChecking: false,
        prefersReducedMotion: false,
      }),
    ).toBe("settle");
  });

  it("stops immediately when motion is reduced", () => {
    expect(
      desktopUpdateCheckMotionAfterSpinIteration({
        isChecking: false,
        prefersReducedMotion: true,
      }),
    ).toBe("idle");
    expect(
      desktopUpdateCheckMotionAfterSpinIteration({
        isChecking: true,
        prefersReducedMotion: true,
      }),
    ).toBe("idle");
  });
});

describe("isDesktopUpdateCheckSettleAnimationEnd", () => {
  it("accepts only the settle keyframe", () => {
    expect(
      isDesktopUpdateCheckSettleAnimationEnd({
        animationName: DESKTOP_UPDATE_CHECK_SETTLE_ANIMATION_NAME,
      }),
    ).toBe(true);
    expect(isDesktopUpdateCheckSettleAnimationEnd({ animationName: "spin" })).toBe(false);
    expect(isDesktopUpdateCheckSettleAnimationEnd({ animationName: "" })).toBe(false);
  });
});

describe("desktopUpdateCheckSpinFrom", () => {
  it("keeps the hover tilt only for a fine-pointer hover click", () => {
    expect(desktopUpdateCheckSpinFrom({ fineHover: true, hovered: true })).toBe("90deg");
    expect(desktopUpdateCheckSpinFrom({ fineHover: true, hovered: false })).toBe("0deg");
    expect(desktopUpdateCheckSpinFrom({ fineHover: false, hovered: true })).toBe("0deg");
    expect(desktopUpdateCheckSpinFrom({ fineHover: false, hovered: false })).toBe("0deg");
  });
});

describe("shouldClearDesktopUpdateCheckSettle", () => {
  it("clears only a live settle after the check has finished", () => {
    expect(shouldClearDesktopUpdateCheckSettle({ isChecking: false, isSettling: true })).toBe(true);
    expect(shouldClearDesktopUpdateCheckSettle({ isChecking: true, isSettling: true })).toBe(false);
    expect(shouldClearDesktopUpdateCheckSettle({ isChecking: false, isSettling: false })).toBe(
      false,
    );
    expect(shouldClearDesktopUpdateCheckSettle({ isChecking: true, isSettling: false })).toBe(
      false,
    );
  });
});
