import { useEffect, useRef } from "react";

/**
 * Pointer-reactive specular highlight for the composer glass shell. Renders
 * an aria-hidden layer and listens for pointermove on its parent (the glass
 * shell): each update writes two CSS vars that move a pre-rasterized radial
 * gradient with `translate` only, rAF-coalesced to at most one write per
 * frame. A still pointer produces zero work; styling and the hover fade live
 * in index.css (.chat-composer-specular), which also disables the layer for
 * coarse pointers and reduced motion.
 */
export function ComposerSpecular() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const host = layer?.parentElement;
    if (!layer || !host) return;
    let frame = 0;
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || frame !== 0) return;
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      frame = requestAnimationFrame(() => {
        frame = 0;
        layer.style.setProperty("--spec-x", `${x}px`);
        layer.style.setProperty("--spec-y", `${y}px`);
      });
    };
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      host.removeEventListener("pointermove", onPointerMove);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={layerRef} aria-hidden className="chat-composer-specular" />;
}
