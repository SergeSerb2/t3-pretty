import { useEffect, useRef } from "react";

/**
 * Pointer-reactive specular highlight for the composer glass shell. Renders
 * an aria-hidden layer and listens for pointermove on its parent (the glass
 * shell): each update writes two CSS vars that move a pre-rasterized radial
 * gradient with `translate` only, rAF-coalesced to at most one write per
 * frame (latest sample wins — every move updates the coordinates, only the
 * scheduling is skipped). A still pointer produces zero work; styling and the
 * hover fade live in index.css (.chat-composer-specular), which also disables
 * the layer for coarse pointers, reduced motion, and the Motion toggle.
 */
export function ComposerSpecular() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const host = layer?.parentElement;
    if (!layer || !host) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const onPointerMove = (event: PointerEvent) => {
      // The Motion toggle hides the layer (index.css); skip the layout read
      // and rAF too so a disabled highlight costs nothing per move.
      if (event.pointerType !== "mouse") return;
      if (!document.documentElement.hasAttribute("data-scenery-motion")) return;
      const rect = host.getBoundingClientRect();
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
      if (frame !== 0) return;
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
