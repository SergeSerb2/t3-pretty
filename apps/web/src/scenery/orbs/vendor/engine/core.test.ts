import { describe, expect, it } from "vite-plus/test";

import { resolvePreset } from "../presets";
import { addDot, beginDots, paint, paintDots } from "./core";
import { drawOrbits } from "./orbits";
import { drawRibbon } from "./ribbon";

interface PaintOp {
  readonly kind: "fillStyle" | "fillRect" | "beginPath" | "arc" | "fill";
  readonly args: readonly unknown[];
}

function recordingContext() {
  const ops: PaintOp[] = [];
  let fillStyle = "";
  const ctx = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = value;
      ops.push({ kind: "fillStyle", args: [value] });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push({ kind: "fillRect", args: [x, y, w, h] });
    },
    beginPath() {
      ops.push({ kind: "beginPath", args: [] });
    },
    arc(x: number, y: number, r: number, start: number, end: number) {
      ops.push({ kind: "arc", args: [x, y, r, start, end] });
    },
    fill() {
      ops.push({ kind: "fill", args: [] });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

describe("thinking-orb painter", () => {
  it("keeps the dark-mode ink ramp used by the contrast contract", () => {
    const { ctx, ops } = recordingContext();
    paint(ctx, [{ x: 0, y: 0, z: 0, r: 1, white: 0.72, a: 0.2 }], true);
    expect(ops.find((op) => op.kind === "fillStyle")?.args).toEqual(["rgba(71,71,71,0.2)"]);
  });

  it("stamps shipped-size marks with fillRect instead of arc", () => {
    const { ctx, ops } = recordingContext();
    paint(ctx, [{ x: 10, y: 12, z: 0, r: 1, white: 0.5, a: 1 }], true);
    expect(ops.some((op) => op.kind === "fillRect")).toBe(true);
    expect(ops.some((op) => op.kind === "arc")).toBe(false);
  });

  it("still uses an antialiased circle when a mark is large", () => {
    const { ctx, ops } = recordingContext();
    paint(ctx, [{ x: 10, y: 12, z: 0, r: 2, white: 0.5, a: 1 }], true);
    expect(ops.some((op) => op.kind === "arc")).toBe(true);
    expect(ops.some((op) => op.kind === "fillRect")).toBe(false);
  });

  it("does not reset fillStyle when consecutive dots share ink", () => {
    const { ctx, ops } = recordingContext();
    paint(
      ctx,
      [
        { x: 0, y: 0, z: 0, r: 1, white: 0.4, a: 1 },
        { x: 2, y: 0, z: 1, r: 1, white: 0.4, a: 1 },
      ],
      true,
    );
    expect(ops.filter((op) => op.kind === "fillStyle")).toHaveLength(1);
    expect(ops.filter((op) => op.kind === "fillRect")).toHaveLength(2);
  });

  it("the hero and working orbs stay on the cheap fillRect path", () => {
    const cases = [
      { state: "breathing" as const, size: 64 as const, draw: drawRibbon },
      { state: "working" as const, size: 20 as const, draw: drawOrbits },
      { state: "working" as const, size: 64 as const, draw: drawOrbits },
    ];
    for (const { state, size, draw } of cases) {
      const { ctx, ops } = recordingContext();
      const { opts } = resolvePreset(state, size);
      draw(ctx, size, 1.2, true, opts);
      expect(
        ops.some((op) => op.kind === "arc"),
        `${state}@${size}`,
      ).toBe(false);
      expect(
        ops.filter((op) => op.kind === "fillRect").length,
        `${state}@${size} marks`,
      ).toBeGreaterThan(10);
    }
  });

  it("drops pooled dots from the previous frame", () => {
    const first = recordingContext();
    beginDots();
    addDot(0, 0, 0, 1, 0.4, 1);
    addDot(2, 0, 0, 1, 0.4, 1);
    paintDots(first.ctx, true);
    expect(first.ops.filter((op) => op.kind === "fillRect")).toHaveLength(2);

    const second = recordingContext();
    beginDots();
    addDot(0, 0, 0, 1, 0.4, 1);
    paintDots(second.ctx, true);
    expect(second.ops.filter((op) => op.kind === "fillRect")).toHaveLength(1);
  });
});
