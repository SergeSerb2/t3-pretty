import { describe, expect, it } from "vite-plus/test";

import {
  clampLook,
  layerTransform,
  lookFromPointer,
  lookHasSettled,
  rigTransform,
  stepPointerLook,
} from "./pointerLook";

describe("lookFromPointer", () => {
  it("maps the window center to a rest pose", () => {
    expect(lookFromPointer(400, 300, 800, 600)).toEqual({ x: 0, y: 0 });
  });

  it("maps the top-left corner to the near-left look", () => {
    expect(lookFromPointer(0, 0, 800, 600)).toEqual({ x: -1, y: -1 });
  });

  it("clamps past the window edge", () => {
    expect(lookFromPointer(900, -20, 800, 600)).toEqual({ x: 1, y: -1 });
  });
});

describe("stepPointerLook", () => {
  it("eases toward the target instead of snapping", () => {
    const stepped = stepPointerLook({ x: 0, y: 0 }, { x: 1, y: 0 }, 16);
    expect(stepped.x).toBeGreaterThan(0);
    expect(stepped.x).toBeLessThan(0.5);
    expect(stepped.y).toBe(0);
  });

  it("settles on the target given enough time", () => {
    let pose = { x: 0, y: 0 };
    const target = { x: 0.4, y: -0.2 };
    for (let i = 0; i < 40; i++) {
      pose = stepPointerLook(pose, target, 32);
    }
    expect(lookHasSettled(pose, target)).toBe(true);
  });

  it("does not move when dt is 0", () => {
    expect(stepPointerLook({ x: 0.2, y: -0.1 }, { x: 1, y: 1 }, 0)).toEqual({ x: 0.2, y: -0.1 });
  });
});

describe("rig and layer transforms", () => {
  it("keeps the rest pose unrotated", () => {
    expect(rigTransform({ x: 0, y: 0 })).toBe("rotateX(0.000deg) rotateY(0.000deg)");
  });

  it("pushes nearer cards toward the camera", () => {
    const near = layerTransform(0.1);
    const far = layerTransform(0.9);
    const nearZ = Number(/translateZ\(([-0-9.]+)px\)/.exec(near)?.[1]);
    const farZ = Number(/translateZ\(([-0-9.]+)px\)/.exec(far)?.[1]);
    expect(nearZ).toBeGreaterThan(farZ);
  });
});

describe("clampLook", () => {
  it("stays inside the unit square", () => {
    expect(clampLook(-4)).toBe(-1);
    expect(clampLook(0.25)).toBe(0.25);
    expect(clampLook(8)).toBe(1);
  });
});
