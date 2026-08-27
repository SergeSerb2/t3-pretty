import { describe, expect, it } from "vite-plus/test";

import {
  DESKTOP_UPDATE_CHECK_SETTLE_ANIMATION_NAME,
  desktopUpdateCheckMotionAfterSpinIteration,
  isDesktopUpdateCheckSettleAnimationEnd,
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
