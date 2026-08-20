/**
 * 2D photo → layered depth image.
 *
 *   photo → depth → region grouping → RGBA cards → inpaint hidden pixels
 *
 * Matches the DA3 / SAM / Fill pipeline's output shape so a baker can swap
 * the estimators without touching the renderer.
 */
import { estimateLandscapeDepth } from "./estimateDepth";
import { groupDepthLayers } from "./groupLayers";
import { dilateMask, inpaintHoles } from "./inpaint";
import { copyRgba } from "./pixels";
import type {
  PixelBuffer,
  SceneryParallaxLayer,
  SceneryParallaxManifest,
  SceneryParallaxScene,
} from "./types";
import { PARALLAX_TARGET_LAYERS } from "./types";

const FRINGE_RADIUS = 2;

export function buildParallaxScene(
  image: PixelBuffer,
  photoId: string,
  targetLayers = PARALLAX_TARGET_LAYERS,
): SceneryParallaxScene {
  const { data, width, height } = image;
  const depth = estimateLandscapeDepth(image);
  const grouping = groupDepthLayers(depth, width, height, targetLayers);
  const working = copyRgba(data);
  const layers: SceneryParallaxLayer[] = [];

  // Front to back: peel each card off the composite, then fill the hole so
  // the card behind has something to show when the camera slides.
  const order = grouping.layerZ
    .map((z, index) => ({ z, index }))
    .sort((left, right) => left.z - right.z);

  for (let step = 0; step < order.length; step++) {
    const { z, index } = order[step]!;
    const isBackground = step === order.length - 1;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = grouping.layerIndex[i] === index ? 1 : 0;
    }
    const rgba = extractLayer(working, width, height, mask, isBackground);
    layers.push({ id: index, z, rgba });
    if (!isBackground) {
      const filled = inpaintHoles(working, width, height, mask);
      working.set(filled);
    }
  }

  // Painter's order: far card first, near card last.
  layers.sort((left, right) => right.z - left.z);

  return {
    photoId,
    width,
    height,
    depth,
    layers,
  };
}

function extractLayer(
  composite: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  isBackground: boolean,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const keep = isBackground ? mask : dilateMask(mask, width, height, FRINGE_RADIUS);
  for (let i = 0; i < mask.length; i++) {
    if (!keep[i]) {
      continue;
    }
    const o = i * 4;
    rgba[o] = composite[o]!;
    rgba[o + 1] = composite[o + 1]!;
    rgba[o + 2] = composite[o + 2]!;
    // Core pixels are solid; the dilated fringe is softer so cards overlap
    // instead of flashing a crack when the camera moves.
    rgba[o + 3] = mask[i] ? 255 : 140;
  }
  if (isBackground) {
    for (let i = 0; i < mask.length; i++) {
      const o = i * 4;
      rgba[o] = composite[o]!;
      rgba[o + 1] = composite[o + 1]!;
      rgba[o + 2] = composite[o + 2]!;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

export function sceneManifest(scene: SceneryParallaxScene): SceneryParallaxManifest {
  return {
    photoId: scene.photoId,
    width: scene.width,
    height: scene.height,
    layers: scene.layers.map((layer) => ({
      z: layer.z,
      pixels: countOpaque(layer.rgba),
    })),
  };
}

function countOpaque(rgba: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if ((rgba[i] ?? 0) > 0) {
      count += 1;
    }
  }
  return count;
}
