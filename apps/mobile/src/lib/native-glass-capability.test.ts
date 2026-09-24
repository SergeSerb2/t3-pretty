import { describe, expect, it } from "vite-plus/test";

import {
  iosMajorVersion,
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
  it("uses native liquid glass when iOS 26 reports the capability", () => {
    expect(supportsNativeLiquidGlass("ios", true, "26.1")).toBe(true);
    expect(supportsNativeLiquidGlass("ios", true, 26)).toBe(true);
  });

  it("keeps pre-glass iOS on the solid fallback", () => {
    expect(supportsNativeLiquidGlass("ios", false, "26.1")).toBe(false);
  });

  it("keeps iOS 27 on the solid fallback while glass selectors churn", () => {
    expect(supportsNativeLiquidGlass("ios", true, "27.0")).toBe(false);
    expect(supportsNativeLiquidGlass("ios", true, 27)).toBe(false);
  });

  it("treats an unparseable iOS version as unsafe", () => {
    expect(supportsNativeLiquidGlass("ios", true, "Version 27.0")).toBe(false);
  });

  it("does not enable iOS liquid-glass layout behavior on other platforms", () => {
    expect(supportsNativeLiquidGlass("android", true, "27")).toBe(false);
    expect(supportsNativeLiquidGlass("web", true, "26.1")).toBe(false);
  });
});

describe("iosMajorVersion", () => {
  it("parses string and numeric iOS versions", () => {
    expect(iosMajorVersion("ios", "27.0")).toBe(27);
    expect(iosMajorVersion("ios", 26.1)).toBe(26);
    expect(iosMajorVersion("android", "27.0")).toBe(0);
  });

  it("returns 0 for an unparseable iOS version string", () => {
    expect(iosMajorVersion("ios", "Version 27.0")).toBe(0);
  });
});
