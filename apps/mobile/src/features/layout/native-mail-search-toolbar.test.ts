import { describe, expect, it } from "vitest";

import {
  iosMajorVersion,
  isNativeMailSearchToolbarSupported,
} from "./native-mail-search-toolbar.logic";

describe("isNativeMailSearchToolbarSupported", () => {
  it("is off when liquid glass is unavailable", () => {
    expect(isNativeMailSearchToolbarSupported(false, "ios", "26.0")).toBe(false);
  });

  it("is on for iOS 26 liquid glass", () => {
    expect(isNativeMailSearchToolbarSupported(true, "ios", "26.1")).toBe(true);
    expect(isNativeMailSearchToolbarSupported(true, "ios", 26)).toBe(true);
  });

  it("is off on iOS 27 where UIGlassEffect selectors have churned", () => {
    expect(isNativeMailSearchToolbarSupported(true, "ios", "27.0")).toBe(false);
    expect(isNativeMailSearchToolbarSupported(true, "ios", 27)).toBe(false);
  });

  it("is off on Android", () => {
    expect(isNativeMailSearchToolbarSupported(true, "android", "27")).toBe(false);
  });
});

describe("iosMajorVersion", () => {
  it("parses string and numeric iOS versions", () => {
    expect(iosMajorVersion("ios", "27.0")).toBe(27);
    expect(iosMajorVersion("ios", 26.1)).toBe(26);
    expect(iosMajorVersion("android", "27.0")).toBe(0);
  });
});
