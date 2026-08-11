import type {
  CanvasDocument,
  CanvasFrameNode,
  CanvasImageNode,
  CanvasInkNode,
  CanvasNode,
  CanvasNoteNode,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  adaptiveGridStep,
  CANVAS_MAX_SCALE,
  CANVAS_MIN_SCALE,
  fitToContent,
  hitTestPoint,
  hitTestRect,
  rectFromPoints,
  resizeRectFromHandle,
  screenRectToWorld,
  screenToWorld,
  strokeHitTest,
  worldRectToScreen,
  worldToScreen,
  zoomAtPoint,
  zoomToScaleAtPoint,
  type CanvasViewportTransform,
} from "./canvasViewport";

const frame = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string,
): CanvasFrameNode => ({
  id,
  type: "frame",
  x,
  y,
  width,
  height,
  ...(parentId === undefined ? {} : { parentId }),
});

const image = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string,
): CanvasImageNode => ({
  id,
  type: "image",
  x,
  y,
  width,
  height,
  attachmentId: "att-1",
  ...(parentId === undefined ? {} : { parentId }),
});

const note = (id: string, x: number, y: number, parentId?: string): CanvasNoteNode => ({
  id,
  type: "note",
  x,
  y,
  text: "note",
  ...(parentId === undefined ? {} : { parentId }),
});

const ink = (
  id: string,
  x: number,
  y: number,
  points: { x: number; y: number }[],
  strokeWidth = 4,
  parentId?: string,
): CanvasInkNode => ({
  id,
  type: "ink",
  x,
  y,
  points,
  color: "#f00",
  strokeWidth,
  ...(parentId === undefined ? {} : { parentId }),
});

const doc = (...nodes: CanvasNode[]): CanvasDocument => ({ schemaVersion: 1, nodes });

describe("transforms", () => {
  const t: CanvasViewportTransform = { tx: 120, ty: -40, scale: 0.8 };

  it("round-trips points between screen and world", () => {
    const screen = { x: 300, y: 200 };
    const world = screenToWorld(t, screen);
    const back = worldToScreen(t, world);
    expect(back.x).toBeCloseTo(screen.x, 9);
    expect(back.y).toBeCloseTo(screen.y, 9);
    expect(world).toEqual({ x: (300 - 120) / 0.8, y: (200 + 40) / 0.8 });
  });

  it("round-trips rects between screen and world", () => {
    const rect = { x: 10, y: 20, width: 200, height: 100 };
    const screen = worldRectToScreen(t, rect);
    expect(screen).toEqual({ x: 10 * 0.8 + 120, y: 20 * 0.8 - 40, width: 160, height: 80 });
    const back = screenRectToWorld(t, screen);
    expect(back.x).toBeCloseTo(rect.x, 9);
    expect(back.y).toBeCloseTo(rect.y, 9);
    expect(back.width).toBeCloseTo(rect.width, 9);
    expect(back.height).toBeCloseTo(rect.height, 9);
  });
});

describe("zoomAtPoint", () => {
  const t: CanvasViewportTransform = { tx: 120, ty: -40, scale: 0.8 };
  const pointer = { x: 300, y: 200 };

  it("keeps the world point under the cursor fixed", () => {
    const before = screenToWorld(t, pointer);
    const zoomedIn = zoomAtPoint(t, pointer, -400);
    const zoomedOut = zoomAtPoint(t, pointer, 250);
    expect(zoomedIn.scale).toBeCloseTo(0.8 * Math.exp(0.6), 9);
    for (const next of [zoomedIn, zoomedOut]) {
      const after = screenToWorld(next, pointer);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  it("clamps the scale to the canvas limits", () => {
    expect(zoomAtPoint(t, pointer, -100000).scale).toBe(CANVAS_MAX_SCALE);
    expect(zoomAtPoint(t, pointer, 100000).scale).toBe(CANVAS_MIN_SCALE);
  });

  it("returns the same transform reference for a zero delta", () => {
    expect(zoomAtPoint(t, pointer, 0)).toBe(t);
  });

  it("zoomToScaleAtPoint hits an explicit target with the same anchor invariant", () => {
    const before = screenToWorld(t, pointer);
    const next = zoomToScaleAtPoint(t, pointer, 1);
    expect(next.scale).toBe(1);
    const after = screenToWorld(next, pointer);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomToScaleAtPoint(t, pointer, 100).scale).toBe(CANVAS_MAX_SCALE);
  });
});

describe("fitToContent", () => {
  const viewport = { width: 500, height: 300 };

  it("centers small content at 100%", () => {
    expect(fitToContent({ x: 10, y: 20, width: 100, height: 50 }, viewport)).toEqual({
      scale: 1,
      tx: (500 - 100) / 2 - 10,
      ty: (300 - 50) / 2 - 20,
    });
  });

  it("scales large content down to fit inside the padding", () => {
    const fitted = fitToContent({ x: -100, y: 0, width: 2000, height: 1000 }, viewport);
    expect(fitted.scale).toBeCloseTo(0.202, 9);
    // Left edge of the content lands exactly at the padding.
    expect(worldToScreen(fitted, { x: -100, y: 0 }).x).toBeCloseTo(48, 9);
  });

  it("falls back to a centered origin for degenerate bounds", () => {
    const fallback = { tx: 250, ty: 150, scale: 1 };
    expect(fitToContent(null, viewport)).toEqual(fallback);
    expect(fitToContent({ x: 0, y: 0, width: 0, height: 0 }, viewport)).toEqual(fallback);
    expect(fitToContent({ x: Number.NaN, y: 0, width: 10, height: 10 }, viewport)).toEqual(
      fallback,
    );
  });

  it("never scales below the minimum even in a tiny viewport", () => {
    expect(
      fitToContent({ x: 0, y: 0, width: 10000, height: 10000 }, { width: 60, height: 60 }).scale,
    ).toBe(CANVAS_MIN_SCALE);
  });
});

describe("hitTestPoint", () => {
  it("returns the topmost node in z-order", () => {
    const document = doc(note("n1", 0, 0), note("n2", 0, 0));
    expect(hitTestPoint(document, { x: 10, y: 10 })?.id).toBe("n2");
  });

  it("hits frames only on the border band and label band", () => {
    const document = doc(frame("f", 0, 0, 200, 150));
    expect(hitTestPoint(document, { x: 100, y: 75 })).toBeNull();
    expect(hitTestPoint(document, { x: 2, y: 75 })?.id).toBe("f");
    expect(hitTestPoint(document, { x: 100, y: 148 })?.id).toBe("f");
    // Label band sits above the top edge.
    expect(hitTestPoint(document, { x: 100, y: -10 })?.id).toBe("f");
    expect(hitTestPoint(document, { x: 100, y: -40 })).toBeNull();
  });

  it("lets frame children win over the frame interior", () => {
    const document = doc(frame("f", 0, 0, 200, 200), image("i", 10, 10, 50, 50, "f"));
    expect(hitTestPoint(document, { x: 30, y: 30 })?.id).toBe("i");
    expect(hitTestPoint(document, { x: 150, y: 150 })).toBeNull();
  });

  it("puts a later parent's children above an earlier parent's children", () => {
    const document = doc(
      frame("f1", 0, 0, 100, 100),
      image("i1", 0, 0, 100, 100, "f1"),
      frame("f2", 50, 0, 100, 100),
      image("i2", 0, 0, 100, 100, "f2"),
    );
    expect(hitTestPoint(document, { x: 75, y: 50 })?.id).toBe("i2");
    expect(hitTestPoint(document, { x: 25, y: 50 })?.id).toBe("i1");
  });

  it("hits ink by segment distance padded with half the stroke width", () => {
    const document = doc(
      ink(
        "s",
        0,
        0,
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        4,
      ),
    );
    expect(hitTestPoint(document, { x: 50, y: 5 })?.id).toBe("s");
    expect(hitTestPoint(document, { x: 50, y: 40 })).toBeNull();
    expect(hitTestPoint(document, { x: 50, y: 12 }, { tolerance: 2 })).toBeNull();
  });

  it("sizes notes from the measured overlay", () => {
    const document = doc(note("n", 0, 0));
    const measuredSizes = new Map([["n", { width: 40, height: 20 }]]);
    expect(hitTestPoint(document, { x: 30, y: 10 }, { measuredSizes })?.id).toBe("n");
    expect(hitTestPoint(document, { x: 60, y: 10 }, { measuredSizes })).toBeNull();
  });
});

describe("strokeHitTest", () => {
  it("measures distance to segments, not just endpoints", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(strokeHitTest(points, { x: 50, y: 3 }, 4)).toBe(true);
    expect(strokeHitTest(points, { x: 50, y: 6 }, 4)).toBe(false);
    expect(strokeHitTest([{ x: 5, y: 5 }], { x: 7, y: 5 }, 3)).toBe(true);
    expect(strokeHitTest([], { x: 0, y: 0 }, 10)).toBe(false);
  });
});

describe("hitTestRect", () => {
  it("selects intersecting children but only fully contained frames", () => {
    const document = doc(frame("f", 0, 0, 200, 200), image("i", 10, 10, 20, 20, "f"));
    expect(hitTestRect(document, { x: 0, y: 0, width: 50, height: 50 })).toEqual(["i"]);
    expect(hitTestRect(document, { x: -10, y: -10, width: 250, height: 250 })).toEqual(["f", "i"]);
  });

  it("intersects world rects for nested and root nodes", () => {
    const document = doc(
      frame("f", 100, 100, 100, 100),
      note("n", 10, 10, "f"),
      ink("s", 300, 300, [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
      ]),
    );
    // n's world origin is (110, 110).
    expect(hitTestRect(document, { x: 105, y: 105, width: 20, height: 20 })).toEqual(["n"]);
    expect(hitTestRect(document, { x: 290, y: 290, width: 10, height: 10 })).toEqual(["s"]);
    expect(hitTestRect(document, { x: 0, y: 0, width: 5, height: 5 })).toEqual([]);
  });
});

describe("rectFromPoints", () => {
  it("normalizes either drag direction into an axis-aligned rect", () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
    expect(rectFromPoints({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe("resizeRectFromHandle", () => {
  const start = { x: 100, y: 100, width: 80, height: 40 };

  it("anchors the opposite corner for each handle", () => {
    expect(resizeRectFromHandle(start, "se", { x: 220, y: 200 })).toEqual({
      x: 100,
      y: 100,
      width: 120,
      height: 100,
    });
    expect(resizeRectFromHandle(start, "nw", { x: 80, y: 90 })).toEqual({
      x: 80,
      y: 90,
      width: 100,
      height: 50,
    });
    expect(resizeRectFromHandle(start, "ne", { x: 200, y: 80 })).toEqual({
      x: 100,
      y: 80,
      width: 100,
      height: 60,
    });
    expect(resizeRectFromHandle(start, "sw", { x: 90, y: 180 })).toEqual({
      x: 90,
      y: 100,
      width: 90,
      height: 80,
    });
  });

  it("clamps at the minimum size instead of flipping past the anchor", () => {
    const rect = resizeRectFromHandle(start, "se", { x: 0, y: 0 });
    expect(rect).toEqual({ x: 100, y: 100, width: 16, height: 16 });
    const custom = resizeRectFromHandle(start, "nw", { x: 500, y: 500 }, { minWidth: 100 });
    expect(custom.width).toBe(100);
    expect(custom.height).toBe(16);
    expect(custom.x + custom.width).toBe(180);
    expect(custom.y + custom.height).toBe(140);
  });

  it("locks the aspect ratio to the dominant axis", () => {
    const rect = resizeRectFromHandle(start, "se", { x: 260, y: 120 }, { aspectRatio: 2 });
    expect(rect).toEqual({ x: 100, y: 100, width: 160, height: 80 });
    const tall = resizeRectFromHandle(start, "se", { x: 120, y: 300 }, { aspectRatio: 2 });
    expect(tall).toEqual({ x: 100, y: 100, width: 400, height: 200 });
  });

  it("keeps minimum sizes while aspect-locked", () => {
    const rect = resizeRectFromHandle(start, "se", { x: 101, y: 101 }, { aspectRatio: 4 });
    expect(rect.height).toBe(16);
    expect(rect.width).toBe(64);
  });
});

describe("adaptiveGridStep", () => {
  it("folds the scaled step into the legible range by powers of two", () => {
    expect(adaptiveGridStep(1)).toBe(24);
    expect(adaptiveGridStep(0.25)).toBe(12);
    expect(adaptiveGridStep(0.05)).toBeCloseTo(19.2);
    expect(adaptiveGridStep(2)).toBe(24);
    expect(adaptiveGridStep(8)).toBe(24);
    expect(adaptiveGridStep(1.5)).toBe(36);
    const step = adaptiveGridStep(3.3);
    expect(step).toBeGreaterThanOrEqual(12);
    expect(step).toBeLessThan(48);
  });

  it("falls back to the base step for degenerate scales", () => {
    expect(adaptiveGridStep(0)).toBe(24);
    expect(adaptiveGridStep(Number.NaN)).toBe(24);
  });
});
