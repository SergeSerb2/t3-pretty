import { describe, expect, it } from "vite-plus/test";

import {
  capGlassBlurPx,
  resolveWorkspaceGlassBlurPx,
  WINDOWS_GLASS_BLUR_CAP_PX,
  WINDOWS_WORKSPACE_GLASS_BLUR_CAP_PX,
} from "./glassAppearance";

describe("Windows glass blur caps", () => {
  it("caps the workspace plate at the Windows ceiling", () => {
    expect(resolveWorkspaceGlassBlurPx(32, true)).toBe(WINDOWS_WORKSPACE_GLASS_BLUR_CAP_PX);
    expect(resolveWorkspaceGlassBlurPx(64, true)).toBe(WINDOWS_WORKSPACE_GLASS_BLUR_CAP_PX);
  });

  it("keeps slider values below the cap untouched on Windows", () => {
    expect(resolveWorkspaceGlassBlurPx(8, true)).toBe(8);
    expect(resolveWorkspaceGlassBlurPx(0, true)).toBe(0);
  });

  it("never caps other platforms", () => {
    expect(resolveWorkspaceGlassBlurPx(32, false)).toBe(32);
    expect(capGlassBlurPx(26, WINDOWS_GLASS_BLUR_CAP_PX, false)).toBe(26);
  });

  it("clamps negative radii to zero on Windows", () => {
    expect(capGlassBlurPx(-4, WINDOWS_GLASS_BLUR_CAP_PX, true)).toBe(0);
  });
});
