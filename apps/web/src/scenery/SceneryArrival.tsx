/**
 * One-shot fog + "Entering…" sequence for a new World Scenery draft. The
 * banks keep a slow compositor-only roll for the overlay's whole life so the
 * veil never freezes while the wallpaper decodes; the overlay unmounts once
 * the location name has handed off to the composer slot.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { useMotionStore } from "./motionStore";
import {
  clearSceneryArrivalRequest,
  hasPlayedSceneryArrival,
  markSceneryArrivalPlayed,
  measureCenterDelta,
  peekSceneryArrivalRequest,
  readSceneryArrivalFogInk,
  readSceneryComposerPlacement,
  remainingFogHoldMs,
  shouldArmSceneryArrival,
  subscribeSceneryArrivalRequest,
  writeSceneryArrivalPhase,
  SCENERY_ARRIVAL,
  SCENERY_COMPOSER_ATTR,
  type SceneryArrivalFogInk,
  type SceneryArrivalPhase,
} from "./sceneryArrivalLogic";
import type { SceneryPhoto } from "./unsplash";
import { useHtmlAttributeStore } from "./useHtmlAttributes";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
  );
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

/**
 * One viewport-sized noise field. A repeating 400px turbulence tile reads as
 * a grid of boxes and seam lines; this is a single warped sheet, rasterized
 * once into the grain bank and then only translated/faded with it.
 */
function FogField() {
  const filterId = `${useId().replaceAll(":", "")}-field`;
  return (
    <svg
      className="scenery-fog__field"
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <filter
        id={filterId}
        x="-200"
        y="-200"
        width="2000"
        height="1400"
        filterUnits="userSpaceOnUse"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.0032 0.0044"
          numOctaves="4"
          seed="17"
          result="n"
        />
        <feDisplacementMap
          in="n"
          in2="n"
          scale="120"
          xChannelSelector="R"
          yChannelSelector="G"
          result="w"
        />
        <feColorMatrix
          in="w"
          type="matrix"
          values="0.18 0.18 0.18 0 0.46  0.18 0.18 0.18 0 0.48  0.18 0.18 0.18 0 0.49  0 0 0 0 1"
        />
      </filter>
      <rect x="-200" y="-200" width="2000" height="1400" filter={`url(#${filterId})`} />
    </svg>
  );
}

function useComposerPlacement(): "hero" | "docked" | null {
  return useHtmlAttributeStore((root) => {
    const value = root.dataset[SCENERY_COMPOSER_ATTR];
    return value === "hero" || value === "docked" ? value : null;
  }, null);
}

export function SceneryArrival({
  photo,
  threadKey,
  photoReady,
  onPhaseChange,
}: {
  readonly photo: SceneryPhoto | null;
  readonly threadKey: string | null;
  /** Wallpaper is decoded and on screen — the veil can lift over it. */
  readonly photoReady: boolean;
  readonly onPhaseChange?: (phase: SceneryArrivalPhase) => void;
}) {
  const placement = useComposerPlacement();
  const motionEnabled = useMotionStore((state) => state.enabled);
  const reducedMotion = useReducedMotion();
  const pendingArrivalKey = useSyncExternalStore(
    subscribeSceneryArrivalRequest,
    peekSceneryArrivalRequest,
    () => null,
  );
  const [phase, setPhase] = useState<SceneryArrivalPhase>("idle");
  const [fogInk, setFogInk] = useState<SceneryArrivalFogInk>("dark");
  const [sequenceKey, setSequenceKey] = useState<string | null>(null);
  const locationRef = useRef<HTMLParagraphElement | null>(null);
  const travelRef = useRef<Animation | null>(null);
  const fogStartedAtRef = useRef<number | null>(null);
  const armedThreadRef = useRef<string | null>(null);
  const originThreadRef = useRef<string | null>(null);
  const revealedRef = useRef(false);
  const onPhaseChangeRef = useRef(onPhaseChange);
  onPhaseChangeRef.current = onPhaseChange;

  const publishPhase = (next: SceneryArrivalPhase) => {
    setPhase(next);
    writeSceneryArrivalPhase(next === "idle" ? null : next);
    onPhaseChangeRef.current?.(next);
  };

  useLayoutEffect(() => {
    return () => {
      writeSceneryArrivalPhase(null);
    };
  }, []);

  // Layout so fog is on the document before SceneryLayer commits a preloaded
  // photo in the same frame. A new-thread click can arm this before the
  // draft route paints (pendingArrivalKey). Placement is re-read from the
  // DOM: ChatView writes hero during its render, which is after this
  // component's render but before this layout effect.
  useLayoutEffect(() => {
    if (pendingArrivalKey !== null && (reducedMotion || !motionEnabled)) {
      clearSceneryArrivalRequest(pendingArrivalKey);
    }

    const livePlacement = readSceneryComposerPlacement() ?? placement;
    const armFromPrime =
      pendingArrivalKey !== null &&
      !reducedMotion &&
      motionEnabled &&
      !hasPlayedSceneryArrival(pendingArrivalKey);
    const armFromRoute = shouldArmSceneryArrival({
      placement: livePlacement,
      threadKey,
      reducedMotion,
      motionEnabled,
      alreadyPlayed: threadKey !== null && hasPlayedSceneryArrival(threadKey),
    });
    const targetKey = armFromPrime ? pendingArrivalKey : threadKey;

    if ((armFromPrime || armFromRoute) && targetKey !== null) {
      if (armedThreadRef.current === targetKey) {
        return;
      }
      originThreadRef.current = threadKey;
      armedThreadRef.current = targetKey;
      revealedRef.current = false;
      fogStartedAtRef.current = performance.now();
      setFogInk(readSceneryArrivalFogInk());
      setSequenceKey(targetKey);
      clearSceneryArrivalRequest(targetKey);
      publishPhase("fog");
      return;
    }

    const armed = armedThreadRef.current;
    const waitingForRoute =
      armed !== null &&
      threadKey !== armed &&
      (threadKey === originThreadRef.current || threadKey === null);
    if (waitingForRoute) {
      return;
    }

    if (armed !== null) {
      travelRef.current?.cancel();
      travelRef.current = null;
    }
    originThreadRef.current = null;
    armedThreadRef.current = null;
    revealedRef.current = false;
    fogStartedAtRef.current = null;
    setSequenceKey(null);
    if (livePlacement === "hero" && threadKey !== null) {
      markSceneryArrivalPlayed(threadKey);
    }
    const nextPhase = livePlacement === "hero" || livePlacement === "docked" ? "settled" : "idle";
    publishPhase(nextPhase);
  }, [motionEnabled, pendingArrivalKey, placement, reducedMotion, threadKey]);

  const photoId = photo?.id ?? null;
  useEffect(() => {
    if (sequenceKey === null || revealedRef.current || threadKey !== sequenceKey) {
      return;
    }

    let cancelled = false;
    let startReveal = 0;
    let settle = 0;

    const beginReveal = () => {
      if (cancelled) {
        return;
      }
      revealedRef.current = true;
      publishPhase("reveal");
      requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        const from = locationRef.current;
        const to = document.querySelector<HTMLElement>("[data-scenery-place-name]");
        if (!from || !to || typeof from.animate !== "function") {
          return;
        }
        const fromRect = from.getBoundingClientRect();
        const toRect = to.getBoundingClientRect();
        if (toRect.width < 1 || toRect.height < 1) {
          return;
        }
        const { dx, dy } = measureCenterDelta(fromRect, toRect);
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          return;
        }
        const animation = from.animate(
          [
            { transform: "translate3d(0, 0, 0)" },
            { transform: `translate3d(${dx}px, ${dy}px, 0)` },
          ],
          {
            duration: SCENERY_ARRIVAL.locationTravelMs,
            easing: SCENERY_ARRIVAL.easeOutExpo,
            fill: "forwards",
          },
        );
        travelRef.current = animation;
        void animation.finished
          .catch(() => undefined)
          .then(() => {
            if (travelRef.current === animation) {
              travelRef.current = null;
            }
          });
      });
      settle = window.setTimeout(
        () => {
          if (cancelled) {
            return;
          }
          markSceneryArrivalPlayed(sequenceKey);
          publishPhase("settled");
        },
        Math.max(SCENERY_ARRIVAL.locationTravelMs, SCENERY_ARRIVAL.fogClearMs),
      );
    };

    if (photoReady && photo !== null) {
      const hold = remainingFogHoldMs(
        fogStartedAtRef.current ?? performance.now(),
        performance.now(),
      );
      startReveal = window.setTimeout(beginReveal, hold);
    } else {
      // Decode never came: lift over whatever is on screen. The bank still
      // leaves with the clear transition instead of a cut. Without a photo
      // there is no name to hand over, so the travel finds nothing to move.
      startReveal = window.setTimeout(beginReveal, SCENERY_ARRIVAL.fogMaxWaitMs);
    }

    return () => {
      if (revealedRef.current) {
        return;
      }
      cancelled = true;
      window.clearTimeout(startReveal);
      window.clearTimeout(settle);
      travelRef.current?.cancel();
      travelRef.current = null;
    };
    // photo is read from this render when photoId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceKey, photoId, photoReady, threadKey]);

  if (phase === "idle" || phase === "settled") {
    return null;
  }

  return (
    <div className="scenery-arrival" data-phase={phase} data-fog={fogInk}>
      {/* Depth-sorted cloud bank, one compositor layer per band: the far
          bank is the veil, the near bank travels furthest, and the grain
          bank is a single warped field so it cannot tile. */}
      <div className="scenery-fog" aria-hidden>
        <div className="scenery-fog__bank scenery-fog__bank--far" />
        <div className="scenery-fog__bank scenery-fog__bank--mid" />
        <div className="scenery-fog__bank scenery-fog__bank--grain">
          <FogField />
        </div>
        <div className="scenery-fog__bank scenery-fog__bank--near" />
      </div>
      {photo && threadKey === sequenceKey ? (
        <>
          <div className="scenery-arrival__copy">
            <p className="scenery-arrival__kicker">Entering...</p>
            <p ref={locationRef} className="scenery-arrival__place">
              {photo.name}
            </p>
          </div>
          <div className="sr-only" aria-live="polite">
            Entering {photo.name}
          </div>
        </>
      ) : null}
    </div>
  );
}
