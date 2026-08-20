/**
 * Layered depth image (LDI) for World Scenery 2.5D parallax.
 *
 * Photos are turned into a handful of RGBA cards plus a dense depth map.
 * The renderer sits those cards at different Z and moves a virtual camera;
 * closer cards travel further. This is the intermediate format a neural
 * pipeline (DA3 + SAM + inpaint) would emit — the JS builder fills the same
 * shape from a single 2D photo.
 */

export interface PixelBuffer {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** One RGBA card. `z` is 0 at the camera and 1 at the far plane. */
export interface SceneryParallaxLayer {
  readonly id: number;
  readonly z: number;
  readonly rgba: Uint8ClampedArray;
}

export interface SceneryParallaxScene {
  readonly photoId: string;
  readonly width: number;
  readonly height: number;
  /** Dense depth, 0 near → 1 far, length width*height. */
  readonly depth: Float32Array;
  readonly layers: ReadonlyArray<SceneryParallaxLayer>;
}

/**
 * The JSON sidecar a baker would write next to layer PNGs. Runtime scenes
 * keep pixels in typed arrays; this is the inspectable manifest.
 */
export interface SceneryParallaxManifest {
  readonly photoId: string;
  readonly width: number;
  readonly height: number;
  readonly layers: ReadonlyArray<{
    readonly z: number;
    readonly pixels: number;
  }>;
}

export const PARALLAX_PROCESS_WIDTH = 384;
export const PARALLAX_MIN_LAYERS = 4;
export const PARALLAX_MAX_LAYERS = 10;
export const PARALLAX_TARGET_LAYERS = 8;
