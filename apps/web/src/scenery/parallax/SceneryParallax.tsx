/**
 * 2.5D LDI renderer for a scenery photo. Builds depth cards off the decoded
 * wallpaper, then tilts the rig from the pointer. The rAF loop only runs
 * while the pose is still catching up, so a still pointer costs nothing.
 */
import { useEffect, useRef, useState } from "react";

import { buildParallaxScene } from "./buildScene";
import { loadCorsImage, rasterizeImage } from "./loadSourceImage";
import {
  layerTransform,
  lookFromPointer,
  lookHasSettled,
  rigTransform,
  stepPointerLook,
  type PointerLook,
} from "./pointerLook";
import type { SceneryParallaxScene } from "./types";

const REST: PointerLook = { x: 0, y: 0 };

function paintLayer(
  canvas: HTMLCanvasElement,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    return;
  }
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
}

export function SceneryParallax({
  photoId,
  url,
  enabled,
  onReady,
}: {
  photoId: string;
  url: string;
  enabled: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const rigRef = useRef<HTMLDivElement | null>(null);
  const lookRef = useRef<PointerLook>(REST);
  const targetRef = useRef<PointerLook>(REST);
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [scene, setScene] = useState<SceneryParallaxScene | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    onReadyRef.current?.(scene !== null || fallback);
  }, [fallback, scene]);

  useEffect(() => {
    if (!enabled) {
      setScene(null);
      setFallback(false);
      onReadyRef.current?.(false);
      return;
    }
    let cancelled = false;
    setScene(null);
    setFallback(false);
    void loadCorsImage(url).then((image) => {
      if (cancelled) {
        return;
      }
      if (!image) {
        setFallback(true);
        return;
      }
      const pixels = rasterizeImage(image);
      if (!pixels) {
        setFallback(true);
        return;
      }
      setScene(buildParallaxScene(pixels, photoId));
    });
    return () => {
      cancelled = true;
      onReadyRef.current?.(false);
    };
  }, [enabled, photoId, url]);

  useEffect(() => {
    const rig = rigRef.current;
    if (!enabled || !rig) {
      return;
    }

    const stop = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      lastTimeRef.current = null;
      rig.classList.remove("scenery-parallax__rig--live");
    };

    const apply = (look: PointerLook) => {
      rig.style.transform = rigTransform(look);
    };

    const tick = (now: number) => {
      const last = lastTimeRef.current ?? now;
      lastTimeRef.current = now;
      const next = stepPointerLook(lookRef.current, targetRef.current, now - last);
      lookRef.current = next;
      apply(next);
      if (lookHasSettled(next, targetRef.current)) {
        apply(targetRef.current);
        lookRef.current = targetRef.current;
        stop();
        return;
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    const kick = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (frameRef.current !== null) {
        return;
      }
      rig.classList.add("scenery-parallax__rig--live");
      lastTimeRef.current = null;
      frameRef.current = window.requestAnimationFrame(tick);
    };

    const onPointer = (event: PointerEvent) => {
      targetRef.current = lookFromPointer(
        event.clientX,
        event.clientY,
        window.innerWidth,
        window.innerHeight,
      );
      kick();
    };
    const onLeave = () => {
      targetRef.current = REST;
      kick();
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        stop();
      }
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("blur", onLeave);
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    apply(lookRef.current);

    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("blur", onLeave);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [enabled, scene, fallback]);

  if (!enabled) {
    return null;
  }

  return (
    <div className="scenery-parallax" data-parallax-ready={scene || fallback ? "" : undefined}>
      <div className="scenery-parallax__rig" ref={rigRef}>
        {scene ? (
          scene.layers.map((layer) => (
            <LayerCard
              height={scene.height}
              key={`${scene.photoId}:${layer.id}`}
              layer={layer}
              width={scene.width}
            />
          ))
        ) : fallback ? (
          <img
            alt=""
            className="scenery-parallax__card scenery-parallax__card--fallback"
            decoding="async"
            draggable={false}
            src={url}
          />
        ) : null}
      </div>
    </div>
  );
}

function LayerCard({
  layer,
  width,
  height,
}: {
  layer: SceneryParallaxScene["layers"][number];
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    paintLayer(canvas, layer.rgba, width, height);
    canvas.style.transform = layerTransform(layer.z);
  }, [height, layer, width]);

  return <canvas aria-hidden className="scenery-parallax__card" ref={canvasRef} />;
}
