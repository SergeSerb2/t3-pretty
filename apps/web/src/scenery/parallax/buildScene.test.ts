import { describe, expect, it } from "vite-plus/test";

import { buildParallaxScene, sceneManifest } from "./buildScene";
import { estimateLandscapeDepth } from "./estimateDepth";
import { groupDepthLayers } from "./groupLayers";
import { inpaintHoles } from "./inpaint";
import { createPixelBuffer } from "./pixels";
import type { PixelBuffer } from "./types";

function paint(
  buffer: PixelBuffer,
  fill: (x: number, y: number) => readonly [number, number, number],
) {
  const { data, width, height } = buffer;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function regionDepth(
  depth: Float32Array,
  width: number,
  predicate: (x: number, y: number) => boolean,
): number {
  const values: number[] = [];
  const height = depth.length / width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (predicate(x, y)) {
        values.push(depth[y * width + x]!);
      }
    }
  }
  return median(values);
}

function landscape(): PixelBuffer {
  const buffer = createPixelBuffer(64, 48);
  paint(buffer, (x, y) => {
    if (x > 22 && x < 38 && y > 28 && y < 46) {
      return [18, 22, 16];
    }
    if (y < 20) {
      return [120, 170, 220];
    }
    return [46, 110, 52];
  });
  return buffer;
}

describe("estimateLandscapeDepth", () => {
  it("puts sky farther than ground, and a dark foreground nearest", () => {
    const image = landscape();
    const depth = estimateLandscapeDepth(image);
    const sky = regionDepth(depth, image.width, (_x, y) => y < 12);
    const ground = regionDepth(depth, image.width, (x, y) => y > 30 && (x < 20 || x > 42));
    const tree = regionDepth(depth, image.width, (x, y) => x > 24 && x < 36 && y > 30 && y < 44);
    expect(sky).toBeGreaterThan(ground);
    expect(ground).toBeGreaterThan(tree);
  });
});

describe("groupDepthLayers", () => {
  it("emits a handful of cards, not a band per pixel", () => {
    const image = landscape();
    const depth = estimateLandscapeDepth(image);
    const grouping = groupDepthLayers(depth, image.width, image.height);
    expect(grouping.layerZ.length).toBeGreaterThanOrEqual(4);
    expect(grouping.layerZ.length).toBeLessThanOrEqual(10);
    expect(grouping.layerIndex.length).toBe(image.width * image.height);
  });

  it("keeps a compact foreground blob on fewer layers than a naive band split", () => {
    const image = landscape();
    const depth = estimateLandscapeDepth(image);
    const grouping = groupDepthLayers(depth, image.width, image.height);
    const layers = new Set<number>();
    for (let y = 32; y < 44; y++) {
      for (let x = 24; x < 36; x++) {
        layers.add(grouping.layerIndex[y * image.width + x]!);
      }
    }
    expect(layers.size).toBeLessThanOrEqual(3);
  });
});

describe("inpaintHoles", () => {
  it("fills a punched rectangle from its surroundings", () => {
    const buffer = createPixelBuffer(16, 16);
    paint(buffer, () => [10, 80, 10]);
    const hole = new Uint8Array(16 * 16);
    for (let y = 6; y < 10; y++) {
      for (let x = 6; x < 10; x++) {
        hole[y * 16 + x] = 1;
        const o = (y * 16 + x) * 4;
        buffer.data[o] = 255;
        buffer.data[o + 1] = 0;
        buffer.data[o + 2] = 0;
      }
    }
    const filled = inpaintHoles(buffer.data, 16, 16, hole);
    const sample = 7 * 16 + 7;
    expect(filled[sample * 4]).toBeLessThan(80);
    expect(filled[sample * 4 + 1]).toBeGreaterThan(40);
  });
});

describe("buildParallaxScene", () => {
  it("peels the photo into back-to-front RGBA cards with a manifest", () => {
    const scene = buildParallaxScene(landscape(), "tree-lake");
    expect(scene.photoId).toBe("tree-lake");
    expect(scene.layers.length).toBeGreaterThanOrEqual(4);
    expect(scene.layers.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < scene.layers.length; i++) {
      expect(scene.layers[i]!.z).toBeLessThanOrEqual(scene.layers[i - 1]!.z);
    }
    const far = scene.layers[0]!;
    const near = scene.layers[scene.layers.length - 1]!;
    expect(far.rgba.length).toBe(scene.width * scene.height * 4);
    expect(countOpaque(far.rgba)).toBeGreaterThan(countOpaque(near.rgba));
    const manifest = sceneManifest(scene);
    expect(manifest.layers).toHaveLength(scene.layers.length);
    expect(manifest.layers[0]?.pixels).toBeGreaterThan(0);
  });
});

function countOpaque(rgba: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if ((rgba[i] ?? 0) > 0) {
      count += 1;
    }
  }
  return count;
}
