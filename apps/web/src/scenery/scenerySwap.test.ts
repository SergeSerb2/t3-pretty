import { describe, expect, it } from "vite-plus/test";

import { planScenerySwap } from "./scenerySwap";

const currentPhoto = { id: "photo-a", blur: 50 };

describe("planScenerySwap", () => {
  it("demotes the displayed photo immediately on a thread switch", () => {
    // The fix for the stale-photo flash: the outgoing photo starts dissolving
    // at route-change time instead of holding through the download.
    expect(
      planScenerySwap({
        current: currentPhoto,
        photoId: "photo-b",
        blur: 50,
        reducedMotion: false,
      }),
    ).toBe("demote-now");
  });

  it("holds the displayed photo for a blur-only swap", () => {
    // Same photo, new CDN variant: holding avoids pulsing toward the gradient
    // while the blur slider drags through values.
    expect(
      planScenerySwap({
        current: currentPhoto,
        photoId: "photo-a",
        blur: 80,
        reducedMotion: false,
      }),
    ).toBe("hold");
  });

  it("holds a thread switch under reduced motion", () => {
    // Nothing fades under reduced motion, so an early demotion would be a
    // hard cut to the gradient; holding cuts photo→photo when ready.
    expect(
      planScenerySwap({ current: currentPhoto, photoId: "photo-b", blur: 50, reducedMotion: true }),
    ).toBe("hold");
  });

  it("does nothing when the target is already displayed", () => {
    expect(
      planScenerySwap({
        current: currentPhoto,
        photoId: "photo-a",
        blur: 50,
        reducedMotion: false,
      }),
    ).toBe("none");
  });

  it("does nothing when no photo is displayed yet", () => {
    expect(
      planScenerySwap({ current: null, photoId: "photo-b", blur: 50, reducedMotion: false }),
    ).toBe("none");
  });
});
