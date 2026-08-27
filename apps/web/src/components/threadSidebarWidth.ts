export const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
export const THREAD_SIDEBAR_DEFAULT_WIDTH = 16 * 16;
export const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
export const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export function resolveThreadSidebarMaximumWidth(viewportWidth: number): number {
  return Math.max(
    THREAD_SIDEBAR_MIN_WIDTH,
    Math.floor(viewportWidth) - THREAD_MAIN_CONTENT_MIN_WIDTH,
  );
}

// The stored width is a preference, not a pixel-perfect layout value: the
// rendered width is clamped by CSS against the live viewport, so a window
// resized without a delivered resize event can never leave the sidebar stuck
// outside its legal range, and growing the window restores the preference.
export function resolveThreadSidebarCssWidth(width: number): string {
  return `min(${width}px, max(${THREAD_SIDEBAR_MIN_WIDTH}px, calc(100vw - ${THREAD_MAIN_CONTENT_MIN_WIDTH}px)))`;
}

export function resolveInitialThreadSidebarWidth(storedWidth: number | null): number {
  return storedWidth === null
    ? THREAD_SIDEBAR_DEFAULT_WIDTH
    : Math.max(THREAD_SIDEBAR_MIN_WIDTH, storedWidth);
}
