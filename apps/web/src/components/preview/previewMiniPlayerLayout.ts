import type { PreviewMiniPlayerPosition, PreviewMiniPlayerSize } from "~/previewMiniPlayerStore";

export const PREVIEW_MINI_PLAYER_EDGE_GAP = 12;
export const PREVIEW_MINI_PLAYER_DEFAULT_SIZE = { width: 320, height: 200 } as const;
export const PREVIEW_MINI_PLAYER_MIN_SIZE = { width: 240, height: 150 } as const;

export function clampPreviewMiniPlayerSize(
  size: PreviewMiniPlayerSize,
  container: PreviewMiniPlayerSize,
  bottomInset = 0,
): PreviewMiniPlayerSize {
  const availableWidth = Math.max(1, container.width - PREVIEW_MINI_PLAYER_EDGE_GAP * 2);
  const availableHeight = Math.max(
    1,
    container.height - Math.max(0, bottomInset) - PREVIEW_MINI_PLAYER_EDGE_GAP * 2,
  );
  return {
    width: Math.round(
      Math.min(Math.max(PREVIEW_MINI_PLAYER_MIN_SIZE.width, size.width), availableWidth),
    ),
    height: Math.round(
      Math.min(Math.max(PREVIEW_MINI_PLAYER_MIN_SIZE.height, size.height), availableHeight),
    ),
  };
}

/** Cursor overlay is inset:0 on the mini webview; ignore panel offsets. */
export function miniPlayerCursorContent(
  overlay: { readonly width: number; readonly height: number } | null,
  source: { readonly width: number; readonly height: number; readonly scale: number } | null,
): {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
} {
  if (!overlay || !source || source.scale <= 0 || source.width <= 0 || source.height <= 0) {
    return { x: 0, y: 0, scale: 1, scrollLeft: 0, scrollTop: 0 };
  }
  const renderedWidth = source.width / source.scale;
  const renderedHeight = source.height / source.scale;
  const scale = Math.min(1, overlay.width / renderedWidth, overlay.height / renderedHeight);
  return {
    x: Math.max(0, (overlay.width - renderedWidth * scale) / 2),
    y: Math.max(0, (overlay.height - renderedHeight * scale) / 2),
    scale,
    scrollLeft: 0,
    scrollTop: 0,
  };
}

export function clampPreviewMiniPlayerPosition(
  position: PreviewMiniPlayerPosition,
  container: PreviewMiniPlayerSize,
  player: PreviewMiniPlayerSize,
  bottomInset = 0,
): PreviewMiniPlayerPosition {
  const reservedBottomSpace = Math.max(0, bottomInset);
  const maxX = Math.max(
    PREVIEW_MINI_PLAYER_EDGE_GAP,
    container.width - player.width - PREVIEW_MINI_PLAYER_EDGE_GAP,
  );
  const maxY = Math.max(
    PREVIEW_MINI_PLAYER_EDGE_GAP,
    container.height - reservedBottomSpace - player.height - PREVIEW_MINI_PLAYER_EDGE_GAP,
  );
  return {
    x: Math.min(Math.max(position.x, PREVIEW_MINI_PLAYER_EDGE_GAP), maxX),
    y: Math.min(Math.max(position.y, PREVIEW_MINI_PLAYER_EDGE_GAP), maxY),
  };
}
