import { describe, expect, it } from "vite-plus/test";

import { normalizePoints, pathFromPoints, strokeBounds } from "./canvasStroke";

describe("pathFromPoints", () => {
  it("returns an empty path for no points", () => {
    expect(pathFromPoints([])).toBe("");
  });

  it("renders a dot for a single point", () => {
    expect(pathFromPoints([{ x: 4, y: 7 }])).toBe("M 4 7 l 0.01 0.01");
  });

  it("smooths interior points with quadratic midpoint curves", () => {
    expect(
      pathFromPoints([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 10 },
      ]),
    ).toBe("M 0 0 Q 10 0 15 5 L 20 10");
  });

  it("connects two points with a straight segment", () => {
    expect(
      pathFromPoints([
        { x: 0, y: 0 },
        { x: 20, y: 10 },
      ]),
    ).toBe("M 0 0 L 20 10");
  });
});

describe("strokeBounds", () => {
  it("pads the point extent by the stroke width plus slop", () => {
    expect(
      strokeBounds(
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        2,
      ),
    ).toEqual({ x: -5, y: -5, width: 20, height: 20 });
  });

  it("returns an empty rect for no points", () => {
    expect(strokeBounds([], 4)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("normalizePoints", () => {
  it("shifts points to their minimum origin", () => {
    expect(
      normalizePoints([
        { x: 5, y: 7 },
        { x: 15, y: 3 },
      ]),
    ).toEqual({
      points: [
        { x: 0, y: 4 },
        { x: 10, y: 0 },
      ],
      origin: { x: 5, y: 3 },
    });
  });

  it("handles empty input", () => {
    expect(normalizePoints([])).toEqual({ points: [], origin: { x: 0, y: 0 } });
  });
});
