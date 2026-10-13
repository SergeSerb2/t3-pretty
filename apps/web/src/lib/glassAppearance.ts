/**
 * Backdrop-filter cost grows with blur radius and glass area, and the
 * workspace plate blurs a full-height sidebar over the scenery photo.
 * Chromium's Windows (ANGLE/D3D11) backdrop path re-filters that area on
 * every frame painted under it, at the display's refresh rate, so the
 * macOS-tuned 32px default can saturate the GPU process on high-refresh
 * Windows desktops while output streams. Cap the effective radii on
 * Windows desktop; the Appearance sliders keep their full range below
 * the caps and every other platform is untouched.
 */
export const WINDOWS_WORKSPACE_GLASS_BLUR_CAP_PX = 16;
export const WINDOWS_GLASS_BLUR_CAP_PX = 10;

export function capGlassBlurPx(blurPx: number, capPx: number, isWindowsDesktop: boolean): number {
  if (!isWindowsDesktop) return blurPx;
  return Math.min(Math.max(blurPx, 0), capPx);
}

export function resolveWorkspaceGlassBlurPx(
  chromeGlassBlurPx: number,
  isWindowsDesktop: boolean,
): number {
  return capGlassBlurPx(chromeGlassBlurPx, WINDOWS_WORKSPACE_GLASS_BLUR_CAP_PX, isWindowsDesktop);
}
