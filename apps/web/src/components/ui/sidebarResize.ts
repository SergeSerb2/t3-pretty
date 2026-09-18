export function clampSidebarWidth(
  width: number,
  options: { minWidth: number; maxWidth: number | (() => number) },
): number {
  const maxWidth = typeof options.maxWidth === "function" ? options.maxWidth() : options.maxWidth;
  return Math.max(options.minWidth, Math.min(width, maxWidth));
}

export function formatSidebarWidth(width: number, getCssWidth?: (width: number) => string): string {
  return getCssWidth?.(width) ?? `${width}px`;
}
