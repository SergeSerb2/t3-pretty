import type { CanvasDocument } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_CANVAS_CROP_PALETTE,
  canvasCropEntryRect,
  canvasCropPaintOrder,
  canvasCropPixelScale,
  canvasCropRect,
  canvasCropVisibleEntries,
  resolveCanvasCropColor,
  wrapCanvasCropText,
} from "./canvasSelectionCrop";

const doc = (nodes: CanvasDocument["nodes"]): CanvasDocument => ({ schemaVersion: 1, nodes });

const image = (id: string, x: number, y: number, parentId?: string) =>
  ({
    id,
    type: "image",
    x,
    y,
    width: 100,
    height: 80,
    attachmentId: `att-${id}`,
    ...(parentId !== undefined ? { parentId } : {}),
  }) as CanvasDocument["nodes"][number];

const frame = (id: string, x: number, y: number) =>
  ({ id, type: "frame", x, y, width: 400, height: 300 }) as CanvasDocument["nodes"][number];

describe("canvasCropRect", () => {
  it("pads the union of the selected rects", () => {
    const rect = canvasCropRect(
      doc([image("a", 0, 0), image("b", 200, 100)]),
      ["a", "b"],
      undefined,
      16,
    );
    expect(rect).toEqual({ x: -16, y: -16, width: 332, height: 212 });
  });

  it("returns null when nothing resolves", () => {
    expect(canvasCropRect(doc([]), ["missing"])).toBeNull();
  });
});

describe("canvasCropPixelScale", () => {
  it("caps the longest edge at the pixel budget", () => {
    expect(canvasCropPixelScale({ x: 0, y: 0, width: 4096, height: 100 }, 2048, 2)).toBeCloseTo(
      0.5,
    );
  });

  it("never exceeds the maximum scale for small crops", () => {
    expect(canvasCropPixelScale({ x: 0, y: 0, width: 100, height: 50 }, 2048, 2)).toBe(2);
  });
});

describe("canvasCropPaintOrder", () => {
  it("emits parents before children with accumulated world offsets", () => {
    const entries = canvasCropPaintOrder(doc([frame("f", 50, 50), image("a", 10, 20, "f")]));
    expect(entries.map((entry) => entry.node.id)).toEqual(["f", "a"]);
    expect(entries[1]?.world).toEqual({ x: 60, y: 70 });
  });
});

describe("canvasCropVisibleEntries", () => {
  it("keeps only entries overlapping the crop rect", () => {
    const entries = canvasCropVisibleEntries(doc([image("a", 0, 0), image("b", 5_000, 5_000)]), {
      x: -20,
      y: -20,
      width: 200,
      height: 200,
    });
    expect(entries.map((entry) => entry.node.id)).toEqual(["a"]);
  });
});

describe("canvasCropEntryRect", () => {
  it("reports the world footprint of a nested node", () => {
    const entries = canvasCropPaintOrder(doc([frame("f", 50, 50), image("a", 10, 20, "f")]));
    const entry = entries[1];
    if (entry === undefined) throw new Error("expected nested entry");
    expect(canvasCropEntryRect(entry)).toEqual({ x: 60, y: 70, width: 100, height: 80 });
  });
});

describe("resolveCanvasCropColor", () => {
  it("maps the dynamic sentinels onto palette colors", () => {
    expect(resolveCanvasCropColor("currentColor", DEFAULT_CANVAS_CROP_PALETTE)).toBe(
      DEFAULT_CANVAS_CROP_PALETTE.foreground,
    );
    expect(resolveCanvasCropColor("var(--color-primary)", DEFAULT_CANVAS_CROP_PALETTE)).toBe(
      DEFAULT_CANVAS_CROP_PALETTE.accent,
    );
    expect(resolveCanvasCropColor(undefined, DEFAULT_CANVAS_CROP_PALETTE)).toBe(
      DEFAULT_CANVAS_CROP_PALETTE.accent,
    );
    expect(resolveCanvasCropColor("#ff0000", DEFAULT_CANVAS_CROP_PALETTE)).toBe("#ff0000");
  });
});

describe("wrapCanvasCropText", () => {
  // One unit per character keeps the expectations readable.
  const measure = (value: string) => value.length;

  it("wraps on words and honors explicit newlines", () => {
    expect(wrapCanvasCropText("hello there\nfriend", 11, measure)).toEqual([
      "hello there",
      "friend",
    ]);
  });

  it("breaks a word that cannot fit on its own line", () => {
    expect(wrapCanvasCropText("abcdefgh", 3, measure)).toEqual(["abc", "def", "gh"]);
  });

  it("caps the rendered line count", () => {
    expect(wrapCanvasCropText("a b c d", 1, measure, 2)).toEqual(["a", "b"]);
  });
});
