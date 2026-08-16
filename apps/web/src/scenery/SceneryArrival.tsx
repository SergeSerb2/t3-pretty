/**
 * One-shot fog + "Entering…" sequence for a new World Scenery draft. The
 * overlay unmounts once the location name has handed off to the composer
 * slot; nothing here loops or keeps a filter live.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { useMotionStore } from "./motionStore";
import {
  hasPlayedSceneryArrival,
  markSceneryArrivalPlayed,
  measureCenterDelta,
  readSceneryArrivalFogInk,
  readSceneryComposerPlacement,
  remainingFogHoldMs,
  shouldArmSceneryArrival,
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
  const [phase, setPhase] = useState<SceneryArrivalPhase>("idle");
  const [fogInk, setFogInk] = useState<SceneryArrivalFogInk>("dark");
  const [sequenceKey, setSequenceKey] = useState<string | null>(null);
  const locationRef = useRef<HTMLParagraphElement | null>(null);
  const travelRef = useRef<Animation | null>(null);
  const fogStartedAtRef = useRef<number | null>(null);
  const armedThreadRef = useRef<string | null>(null);
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
  // photo in the same frame. Placement is re-read from the DOM: ChatView
  // writes hero during its render, which is after this component's render
  // but before this layout effect.
  useLayoutEffect(() => {
    const alreadyPlayed = threadKey !== null && hasPlayedSceneryArrival(threadKey);
    const livePlacement = readSceneryComposerPlacement() ?? placement;
    const arm = shouldArmSceneryArrival({
      placement: livePlacement,
      threadKey,
      reducedMotion,
      motionEnabled,
      alreadyPlayed,
    });

    if (arm && threadKey !== null) {
      if (armedThreadRef.current === threadKey) {
        return;
      }
      armedThreadRef.current = threadKey;
      revealedRef.current = false;
      fogStartedAtRef.current = performance.now();
      setFogInk(readSceneryArrivalFogInk());
      setSequenceKey(threadKey);
      publishPhase("fog");
      return;
    }

    if (armedThreadRef.current !== null) {
      travelRef.current?.cancel();
      travelRef.current = null;
    }
    armedThreadRef.current = null;
    revealedRef.current = false;
    fogStartedAtRef.current = null;
    setSequenceKey(null);
    if (livePlacement === "hero" && threadKey !== null) {
      markSceneryArrivalPlayed(threadKey);
    }
    const nextPhase = livePlacement === "hero" || livePlacement === "docked" ? "settled" : "idle";
    publishPhase(nextPhase);
  }, [motionEnabled, placement, reducedMotion, threadKey]);

  const photoId = photo?.id ?? null;
  useEffect(() => {
    if (sequenceKey === null || revealedRef.current) {
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
      startReveal = window.setTimeout(() => {
        if (photo !== null) {
          beginReveal();
          return;
        }
        if (cancelled) {
          return;
        }
        revealedRef.current = true;
        markSceneryArrivalPlayed(sequenceKey);
        publishPhase("settled");
      }, SCENERY_ARRIVAL.fogMaxWaitMs);
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
  }, [sequenceKey, photoId, photoReady]);

  if (phase === "idle" || phase === "settled") {
    return null;
  }

  return (
    <div className="scenery-arrival" data-phase={phase} data-fog={fogInk}>
      <div className="scenery-fog" aria-hidden>
        <div className="scenery-fog__sheet scenery-fog__sheet--a" />
        <div className="scenery-fog__sheet scenery-fog__sheet--b" />
        <div className="scenery-fog__sheet scenery-fog__sheet--c" />
      </div>
      {photo ? (
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
