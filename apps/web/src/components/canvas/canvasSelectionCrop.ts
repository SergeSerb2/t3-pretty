/**
 * Renders a canvas selection into a PNG crop for the chat composer.
 *
 * The crop is the union of the selected nodes' world rects, padded, and
 * repainted onto a 2D canvas at up to 2x device pixels. Everything that
 * *intersects* that rect is drawn - not just the selection - so the crop reads
 * like a screenshot of that part of the canvas rather than a cut-out; the
 * structured `CanvasSelectionContext` carries which nodes were actually
 * selected.
 *
 * The geometry, text-wrapping, and color-resolution helpers are exported and
 * unit-tested on their own; only `renderCanvasSelectionCrop` touches the DOM,
 * and it resolves to `null` on any failure (unloadable or cross-origin-tainted
 * image, missing 2D context) so callers can fall back to metadata-only.
 */
import type { CanvasDocument, CanvasImageNode, CanvasNode } from "@t3tools/contracts";

import {
  CANVAS_DEFAULT_NOTE_WIDTH,
  localRectOf,
  unionRects,
  worldRectOf,
  type CanvasMeasuredSizes,
  type CanvasRect,
} from "~/canvasDocSync";
import type { CanvasPoint } from "~/canvasViewport";

import { pathFromPoints } from "./canvasStroke";

/** World-unit margin added around the selection's union rect. */
export const CANVAS_SELECTION_CROP_PADDING = 16;
/** Longest edge of the rendered PNG, in pixels. */
export const CANVAS_SELECTION_CROP_MAX_DIMENSION = 2048;
/** Never render above 2x, however small the selection is. */
export const CANVAS_SELECTION_CROP_MAX_SCALE = 2;

const NOTE_FONT_SIZE = 14;
const NOTE_LINE_HEIGHT = 19;
const NOTE_PADDING = 8;
const NOTE_MIN_HEIGHT = 40;
const NOTE_RADIUS = 6;
const LABEL_FONT_SIZE = 10;
const FRAME_LABEL_FONT_SIZE = 11;
const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export interface CanvasCropPalette {
  readonly background: string;
  readonly foreground: string;
  readonly accent: string;
  readonly noteBackground: string;
  readonly noteForeground: string;
}

export const DEFAULT_CANVAS_CROP_PALETTE: CanvasCropPalette = {
  background: "#ffffff",
  foreground: "#111827",
  accent: "#4f46e5",
  noteBackground: "#fef3c6",
  noteForeground: "#451a03",
};

const TRANSPARENT_COLORS = new Set(["transparent", "rgba(0, 0, 0, 0)", ""]);

/**
 * Palette sampled from a live canvas element, so the crop matches the theme
 * the user is looking at. Falls back to the light defaults outside the DOM.
 */
export function readCanvasCropPalette(element: Element | null): CanvasCropPalette {
  if (element === null || typeof window === "undefined") return DEFAULT_CANVAS_CROP_PALETTE;
  const styles = window.getComputedStyle(element);
  const value = (raw: string, fallback: string): string => {
    const trimmed = raw.trim();
    return trimmed.length === 0 || TRANSPARENT_COLORS.has(trimmed) ? fallback : trimmed;
  };
  const foreground = value(styles.color, DEFAULT_CANVAS_CROP_PALETTE.foreground);
  return {
    background: value(styles.backgroundColor, DEFAULT_CANVAS_CROP_PALETTE.background),
    foreground,
    accent: value(styles.getPropertyValue("--color-primary"), DEFAULT_CANVAS_CROP_PALETTE.accent),
    noteBackground: DEFAULT_CANVAS_CROP_PALETTE.noteBackground,
    noteForeground: DEFAULT_CANVAS_CROP_PALETTE.noteForeground,
  };
}

/**
 * Canvas colors are literal CSS colors; the document may also carry the two
 * dynamic sentinels the DOM renderers rely on (`currentColor` for theme ink,
 * `var(--...)` for the region default).
 */
export function resolveCanvasCropColor(
  color: string | undefined,
  palette: CanvasCropPalette,
): string {
  const trimmed = color?.trim() ?? "";
  if (trimmed.length === 0) return palette.accent;
  if (trimmed === "currentColor") return palette.foreground;
  if (trimmed.startsWith("var(")) return palette.accent;
  return trimmed;
}

/** Padded union of the selected nodes' world rects, or null when empty. */
export function canvasCropRect(
  doc: CanvasDocument,
  selectedIds: readonly string[],
  measuredSizes?: CanvasMeasuredSizes,
  padding = CANVAS_SELECTION_CROP_PADDING,
): CanvasRect | null {
  let bounds: CanvasRect | null = null;
  for (const id of selectedIds) {
    bounds = unionRects(bounds, worldRectOf(doc, id, measuredSizes));
  }
  if (bounds === null) return null;
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: Math.max(1, bounds.width + padding * 2),
    height: Math.max(1, bounds.height + padding * 2),
  };
}

/** Device-pixel scale that keeps the longest edge within the PNG budget. */
export function canvasCropPixelScale(
  rect: CanvasRect,
  maxDimension = CANVAS_SELECTION_CROP_MAX_DIMENSION,
  maxScale = CANVAS_SELECTION_CROP_MAX_SCALE,
): number {
  const longest = Math.max(rect.width, rect.height);
  if (!Number.isFinite(longest) || longest <= 0) return maxScale;
  return Math.max(0.05, Math.min(maxScale, maxDimension / longest));
}

export interface CanvasCropPaintEntry {
  readonly node: CanvasNode;
  /** The node's own origin in world space (its parent chain resolved). */
  readonly world: CanvasPoint;
}

/**
 * Nodes in paint order: siblings bottom-to-top, each frame immediately
 * followed by its subtree, matching `CanvasNodeTree`'s DOM order.
 */
export function canvasCropPaintOrder(doc: CanvasDocument): CanvasCropPaintEntry[] {
  const byParent = new Map<string | null, CanvasNode[]>();
  for (const node of doc.nodes) {
    const parentKey = node.parentId ?? null;
    const siblings = byParent.get(parentKey);
    if (siblings) siblings.push(node);
    else byParent.set(parentKey, [node]);
  }
  const entries: CanvasCropPaintEntry[] = [];
  const seen = new Set<string>();
  const visit = (siblings: readonly CanvasNode[], offsetX: number, offsetY: number): void => {
    for (const node of siblings) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const world = { x: offsetX + node.x, y: offsetY + node.y };
      entries.push({ node, world });
      visit(byParent.get(node.id) ?? [], world.x, world.y);
    }
  };
  visit(byParent.get(null) ?? [], 0, 0);
  return entries;
}

/** World footprint of a paint entry, including ink's stroke padding. */
export function canvasCropEntryRect(
  entry: CanvasCropPaintEntry,
  measuredSizes?: CanvasMeasuredSizes,
): CanvasRect {
  const local = localRectOf(entry.node, measuredSizes);
  return {
    x: entry.world.x + (local.x - entry.node.x),
    y: entry.world.y + (local.y - entry.node.y),
    width: local.width,
    height: local.height,
  };
}

const intersects = (a: CanvasRect, b: CanvasRect): boolean =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/** Paint-ordered entries that overlap the crop rect at all. */
export function canvasCropVisibleEntries(
  doc: CanvasDocument,
  rect: CanvasRect,
  measuredSizes?: CanvasMeasuredSizes,
): CanvasCropPaintEntry[] {
  return canvasCropPaintOrder(doc).filter((entry) =>
    intersects(rect, canvasCropEntryRect(entry, measuredSizes)),
  );
}

/**
 * Greedy word wrap honoring explicit newlines, breaking mid-word only when a
 * single word cannot fit. `measure` keeps the helper free of canvas APIs.
 */
export function wrapCanvasCropText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
  maxLines = 60,
): string[] {
  const lines: string[] = [];
  const width = Math.max(1, maxWidth);
  const pushWord = (word: string, current: string): string => {
    if (current.length === 0) return word;
    const candidate = `${current} ${word}`;
    if (measure(candidate) <= width) return candidate;
    lines.push(current);
    return word;
  };
  for (const paragraph of text.split("\n")) {
    if (lines.length >= maxLines) break;
    let current = "";
    for (const word of paragraph.split(/\s+/).filter((entry) => entry.length > 0)) {
      if (measure(word) <= width) {
        current = pushWord(word, current);
        continue;
      }
      // A single unbreakable run: flush, then split it by character.
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      let chunk = "";
      for (const char of word) {
        if (chunk.length > 0 && measure(chunk + char) > width) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    }
    lines.push(current);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(0, maxLines);
}

export interface CanvasSelectionCrop {
  readonly file: File;
  readonly width: number;
  readonly height: number;
}

export interface CanvasSelectionCropInput {
  readonly doc: CanvasDocument;
  readonly selectedIds: readonly string[];
  readonly measuredSizes?: CanvasMeasuredSizes | undefined;
  /** Loadable URL for an image node (local preview or signed asset URL). */
  readonly resolveImageSrc: (node: CanvasImageNode) => string | null;
  readonly palette: CanvasCropPalette;
  readonly fileName: string;
  readonly padding?: number;
  readonly maxDimension?: number;
}

function loadCropImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    // data: URLs are same-origin by definition and reject the CORS attribute
    // in some engines; asset URLs are served with Access-Control-Allow-Origin.
    if (!src.startsWith("data:")) image.crossOrigin = "anonymous";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => resolve(null), { once: true });
    image.src = src;
  });
}

function traceRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.rect(x, y, width, height);
}

function drawLabelChip(
  ctx: CanvasRenderingContext2D,
  input: { x: number; y: number; text: string; color: string },
): void {
  ctx.font = `600 ${LABEL_FONT_SIZE}px ${SANS}`;
  ctx.textBaseline = "middle";
  const paddingX = 5;
  const height = LABEL_FONT_SIZE + 6;
  const width = Math.min(240, ctx.measureText(input.text).width + paddingX * 2);
  const y = input.y - height - 4;
  ctx.fillStyle = input.color;
  traceRoundRect(ctx, input.x, y, width, height, 3);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.save();
  ctx.beginPath();
  ctx.rect(input.x, y, width, height);
  ctx.clip();
  ctx.fillText(input.text, input.x + paddingX, y + height / 2);
  ctx.restore();
}

function drawNote(
  ctx: CanvasRenderingContext2D,
  node: Extract<CanvasNode, { type: "note" }>,
  rect: CanvasRect,
  palette: CanvasCropPalette,
): void {
  const width = Math.max(node.width ?? rect.width ?? CANVAS_DEFAULT_NOTE_WIDTH, 24);
  ctx.font = `${NOTE_FONT_SIZE}px ${SANS}`;
  const lines = wrapCanvasCropText(
    node.text,
    width - NOTE_PADDING * 2,
    (value) => ctx.measureText(value).width,
  );
  const height = Math.max(
    NOTE_MIN_HEIGHT,
    rect.height,
    NOTE_PADDING * 2 + Math.max(lines.length, 1) * NOTE_LINE_HEIGHT,
  );
  ctx.fillStyle =
    node.color !== undefined && node.color !== "" ? node.color : palette.noteBackground;
  traceRoundRect(ctx, 0, 0, width, height, NOTE_RADIUS);
  ctx.fill();
  ctx.fillStyle = palette.noteForeground;
  ctx.textBaseline = "top";
  lines.forEach((line, index) => {
    ctx.fillText(line, NOTE_PADDING, NOTE_PADDING + index * NOTE_LINE_HEIGHT);
  });
}

function drawEntry(
  ctx: CanvasRenderingContext2D,
  entry: CanvasCropPaintEntry,
  input: {
    palette: CanvasCropPalette;
    images: ReadonlyMap<string, HTMLImageElement>;
    measuredSizes?: CanvasMeasuredSizes | undefined;
  },
): void {
  const { node } = entry;
  const { palette } = input;
  ctx.save();
  ctx.translate(entry.world.x, entry.world.y);
  switch (node.type) {
    case "image": {
      const bitmap = input.images.get(node.id);
      if (bitmap !== undefined) {
        ctx.save();
        traceRoundRect(ctx, 0, 0, node.width, node.height, 3);
        ctx.clip();
        ctx.drawImage(bitmap, 0, 0, Math.max(node.width, 1), Math.max(node.height, 1));
        ctx.restore();
      }
      break;
    }
    case "ink": {
      ctx.strokeStyle = resolveCanvasCropColor(node.color, palette);
      ctx.lineWidth = Math.max(node.strokeWidth, 0.5);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(new Path2D(pathFromPoints(node.points)));
      break;
    }
    case "region": {
      const color = resolveCanvasCropColor(node.color, palette);
      traceRoundRect(ctx, 0, 0, Math.max(node.width, 1), Math.max(node.height, 1), 3);
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (node.label !== undefined && node.label !== "") {
        drawLabelChip(ctx, { x: 0, y: 0, text: node.label, color });
      }
      break;
    }
    case "frame": {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = palette.foreground;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      traceRoundRect(ctx, 0, 0, Math.max(node.width, 1), Math.max(node.height, 1), 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = palette.foreground;
      ctx.font = `500 ${FRAME_LABEL_FONT_SIZE}px ${SANS}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(node.name ?? "Frame", 0, -4);
      ctx.globalAlpha = 1;
      break;
    }
    case "note": {
      drawNote(ctx, node, canvasCropEntryRect(entry), palette);
      break;
    }
  }
  ctx.restore();
}

/**
 * Paint the selection (plus whatever it overlaps) into a PNG `File`.
 * Resolves to null when the crop cannot be produced faithfully.
 */
export async function renderCanvasSelectionCrop(
  input: CanvasSelectionCropInput,
): Promise<CanvasSelectionCrop | null> {
  if (typeof document === "undefined") return null;
  const rect = canvasCropRect(
    input.doc,
    input.selectedIds,
    input.measuredSizes,
    input.padding ?? CANVAS_SELECTION_CROP_PADDING,
  );
  if (rect === null) return null;

  const entries = canvasCropVisibleEntries(input.doc, rect, input.measuredSizes);
  const selected = new Set(input.selectedIds);
  const images = new Map<string, HTMLImageElement>();
  const imageEntries = entries.flatMap((entry) =>
    entry.node.type === "image" ? [entry.node as CanvasImageNode] : [],
  );
  const loaded = await Promise.all(
    imageEntries.map(async (node) => {
      const src = input.resolveImageSrc(node);
      return { node, bitmap: src === null ? null : await loadCropImage(src) };
    }),
  );
  for (const { node, bitmap } of loaded) {
    // A selected image the crop cannot show would misrepresent the selection;
    // an unresolved background image is merely context and is skipped.
    if (bitmap === null) {
      if (selected.has(node.id)) return null;
      continue;
    }
    images.set(node.id, bitmap);
  }

  const scale = canvasCropPixelScale(
    rect,
    input.maxDimension ?? CANVAS_SELECTION_CROP_MAX_DIMENSION,
  );
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const ctx = surface.getContext("2d");
  if (ctx === null) return null;

  try {
    ctx.scale(scale, scale);
    ctx.fillStyle = input.palette.background;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.translate(-rect.x, -rect.y);
    for (const entry of entries) {
      drawEntry(ctx, entry, {
        palette: input.palette,
        images,
        measuredSizes: input.measuredSizes,
      });
    }
  } catch {
    return null;
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      surface.toBlob((result) => resolve(result), "image/png");
    } catch {
      // Tainted canvas: an image slipped through without CORS headers.
      resolve(null);
    }
  });
  if (blob === null) return null;
  return {
    file: new File([blob], input.fileName, { type: "image/png" }),
    width,
    height,
  };
}
