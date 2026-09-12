import { describe, expect, it } from "vite-plus/test";

import {
  readNativeLiquidGlassCapability,
  supportsNativeLiquidGlass,
} from "./native-glass-capability";

describe("readNativeLiquidGlassCapability", () => {
  it("returns the native capability when the module responds", () => {
    expect(readNativeLiquidGlassCapability(() => true)).toBe(true);
    expect(readNativeLiquidGlassCapability(() => false)).toBe(false);
  });

  it("falls back when the native module throws during startup", () => {
    expect(
      readNativeLiquidGlassCapability(() => {
        throw new Error("native glass selector unavailable");
      }),
    ).toBe(false);
  });
});

describe("supportsNativeLiquidGlass", () => {
  it("uses native liquid glass when iOS reports the capability", () => {
    expect(supportsNativeLiquidGlass("ios", true)).toBe(true);
  });

  it("keeps pre-glass iOS on the solid fallback", () => {
    expect(supportsNativeLiquidGlass("ios", false)).toBe(false);
  });

  it("does not enable iOS liquid-glass layout behavior on other platforms", () => {
    expect(supportsNativeLiquidGlass("android", true)).toBe(false);
    expect(supportsNativeLiquidGlass("web", true)).toBe(false);
  });
});
