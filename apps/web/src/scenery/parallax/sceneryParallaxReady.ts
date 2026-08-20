/**
 * The CSS wallpaper stays up until this mount's cards (or the CORS fallback)
 * have actually painted. A leftover ready key from a previous 3D session must
 * not hide the photo the moment the setting is turned back on.
 */
export function sceneryParallaxReady(input: {
  readonly enabled: boolean;
  readonly displayedKey: string | null;
  readonly readyKey: string | null;
}): boolean {
  return input.enabled && input.displayedKey !== null && input.readyKey === input.displayedKey;
}
