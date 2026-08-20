import { describe, expect, it } from "vite-plus/test";

import { sceneryParallaxReady } from "./sceneryParallaxReady";

describe("sceneryParallaxReady", () => {
  it("hides the CSS photo only after this mount reports ready", () => {
    expect(sceneryParallaxReady({ enabled: true, displayedKey: "a@50", readyKey: "a@50" })).toBe(
      true,
    );
    expect(sceneryParallaxReady({ enabled: true, displayedKey: "a@50", readyKey: null })).toBe(
      false,
    );
  });

  it("keeps the CSS photo when 3D is parked, even if a leftover ready key still matches", () => {
    expect(sceneryParallaxReady({ enabled: false, displayedKey: "a@50", readyKey: "a@50" })).toBe(
      false,
    );
  });

  it("does not treat a previous photo's ready key as covering the current one", () => {
    expect(sceneryParallaxReady({ enabled: true, displayedKey: "b@50", readyKey: "a@50" })).toBe(
      false,
    );
  });
});
