/**
 * One-shot fog + "Entering…" sequence for a new World Scenery draft. The
 * overlay unmounts once the location name has handed off to the composer
 * slot; nothing here loops or keeps a filter live.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useMotionStore } from "./motionStore";
import {
  hasPlayedSceneryArrival,
  markSceneryArrivalPlayed,
  measureCenterDelta,
  sceneryArrivalSettleAtMs,
  shouldPlaySceneryArrival,
  writeSceneryArrivalPhase,
  SCENERY_ARRIVAL,
  SCENERY_COMPOSER_ATTR,
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
}: {
  readonly photo: SceneryPhoto | null;
  readonly threadKey: string | null;
}) {
  const placement = useComposerPlacement();
  const motionEnabled = useMotionStore((state) => state.enabled);
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<SceneryArrivalPhase>("idle");
  const locationRef = useRef<HTMLParagraphElement | null>(null);
  const travelRef = useRef<Animation | null>(null);

  useEffect(() => {
    const alreadyPlayed = threadKey !== null && hasPlayedSceneryArrival(threadKey);
    const waitingForPhoto =
      placement === "hero" &&
      photo === null &&
      threadKey !== null &&
      !alreadyPlayed &&
      motionEnabled &&
      !reducedMotion;
    const play = shouldPlaySceneryArrival({
      placement,
      threadKey,
      hasPhoto: photo !== null,
      reducedMotion,
      motionEnabled,
      alreadyPlayed,
    });

    travelRef.current?.cancel();
    travelRef.current = null;

    if (waitingForPhoto) {
      setPhase("idle");
      writeSceneryArrivalPhase(null);
      return () => {
        writeSceneryArrivalPhase(null);
      };
    }

    if (!play || !photo || !threadKey) {
      if (placement === "hero" && threadKey !== null) {
        markSceneryArrivalPlayed(threadKey);
      }
      const nextPhase = placement === "hero" || placement === "docked" ? "settled" : "idle";
      setPhase(nextPhase);
      writeSceneryArrivalPhase(nextPhase === "idle" ? null : nextPhase);
      return () => {
        writeSceneryArrivalPhase(null);
      };
    }

    let cancelled = false;
    setPhase("fog");
    writeSceneryArrivalPhase("fog");

    const startReveal = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      setPhase("reveal");
      writeSceneryArrivalPhase("reveal");
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
    }, SCENERY_ARRIVAL.fogHoldMs);

    const settle = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      markSceneryArrivalPlayed(threadKey);
      setPhase("settled");
      writeSceneryArrivalPhase("settled");
    }, sceneryArrivalSettleAtMs());

    return () => {
      cancelled = true;
      window.clearTimeout(startReveal);
      window.clearTimeout(settle);
      travelRef.current?.cancel();
      travelRef.current = null;
      writeSceneryArrivalPhase(null);
    };
  }, [motionEnabled, photo?.id, placement, reducedMotion, threadKey]);

  if (phase === "idle" || phase === "settled" || photo === null) {
    return null;
  }

  return (
    <div className="scenery-arrival" data-phase={phase}>
      <div className="scenery-fog" aria-hidden>
        <div className="scenery-fog__sheet scenery-fog__sheet--a" />
        <div className="scenery-fog__sheet scenery-fog__sheet--b" />
        <div className="scenery-fog__sheet scenery-fog__sheet--c" />
      </div>
      <div className="scenery-arrival__copy">
        <p className="scenery-arrival__kicker">Entering...</p>
        <p ref={locationRef} className="scenery-arrival__place">
          {photo.name}
        </p>
      </div>
      <div className="sr-only" aria-live="polite">
        Entering {photo.name}
      </div>
    </div>
  );
}
