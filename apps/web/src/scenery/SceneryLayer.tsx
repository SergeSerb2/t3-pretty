/**
 * The full-window scenery surface: gradient fallback, pre-blurred photo, and
 * legibility wash, stacked exactly like SurgeCode's WindowLayers. The scenery
 * group is isolated and fades as ONE layer (see glass.ts for why), the wash
 * carries text contrast, and the attribution pill satisfies the Unsplash
 * guidelines wherever a photo shows prominently.
 *
 * Thread-switch motion: the outgoing photo starts dissolving the moment the
 * route changes — not after the next one has downloaded — so a switch always
 * animates instead of holding a stale photo at full opacity for the whole
 * load gap (that hold read as a glitchy flash of the thread being left). The
 * incoming photo fades in over whatever remains: a direct crossfade when the
 * CDN cache is warm, a dissolve through the new thread's gradient when it is
 * not. Blur-only swaps (same photo, new CDN variant) keep the hold — the old
 * variant stays put until the decoded one crossfades in, or slider drags
 * would pulse the photo toward the gradient. Under reduced motion nothing
 * fades: swaps commit as hard cuts once the image is ready. When the new
 * photo also flips the ink appearance, the commit is wrapped in a view
 * transition so the palette, wash, and wallpaper dissolve together — and the
 * CSS layers are parked (settled, no outgoing) so nothing re-animates when
 * the snapshot finishes.
 */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useMotionStore } from "./motionStore";
import { gradientCss } from "./palette";
import { runSceneryInkTransition } from "./sceneryInkTransition";
import { planScenerySwap } from "./scenerySwap";
import { UNSPLASH_UTM, wallpaperURL, type SceneryPhoto } from "./unsplash";

interface DisplayedPhoto {
  readonly id: string;
  readonly blur: number;
  readonly url: string;
  readonly name: string;
  readonly photographerName: string;
  readonly photographerProfileURL: string | null;
}

/** Fade-out of the outgoing photo; mirrors --scenery-swap-out in scenery.css. */
const SCENERY_SWAP_OUT_MS = 600;

function displayedPhotoKey(photo: DisplayedPhoto): string {
  return `${photo.id}@${photo.blur}`;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (!useMotionStore.getState().enabled) {
    return true;
  }
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function SceneryLayer({
  photo,
  seed,
  blur,
  appearanceCrossfade = false,
  onPhotoDisplayed,
}: {
  photo: SceneryPhoto | null;
  /** Deterministic gradient seed (thread key or daily key). */
  seed: string;
  /** CDN pre-blur strength (0–100); a change cross-fades like a photo swap. */
  blur: number;
  /**
   * The incoming photo will also flip light↔dark ink. Commit the decoded
   * swap inside a view transition so chrome and wash don't snap first.
   */
  appearanceCrossfade?: boolean;
  onPhotoDisplayed?: (photo: SceneryPhoto) => void;
}) {
  const [displayed, setDisplayed] = useState<DisplayedPhoto | null>(null);
  const [outgoing, setOutgoing] = useState<DisplayedPhoto | null>(null);
  // A photo committed inside an ink view transition mounts settled: the
  // snapshot already crossfaded it, so a CSS fade would replay afterwards.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const appearanceCrossfadeRef = useRef(appearanceCrossfade);
  appearanceCrossfadeRef.current = appearanceCrossfade;
  const onPhotoDisplayedRef = useRef(onPhotoDisplayed);
  onPhotoDisplayedRef.current = onPhotoDisplayed;

  // Committed-state mirror for the load effect; synced in an effect (not
  // during render) so a discarded render cannot corrupt it. Declared before
  // the load effect so it is current by the time that effect runs.
  const displayedRef = useRef<DisplayedPhoto | null>(null);
  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  const photoId = photo?.id ?? null;
  useEffect(() => {
    const current = displayedRef.current;
    if (!photo || photoId === null || (current?.id === photoId && current.blur === blur)) {
      return;
    }
    const url = wallpaperURL(photo, blur);
    const plan = planScenerySwap({
      current,
      photoId,
      blur,
      reducedMotion: prefersReducedMotion(),
    });
    if (plan === "demote-now" && current !== null) {
      // Thread switch: demote the photo on screen to the dissolving underlay
      // right now, so the transition runs concurrently with the download.
      setOutgoing(current);
      setDisplayed(null);
    }
    let cancelled = false;
    const image = new Image();
    image.addEventListener(
      "load",
      () => {
        if (cancelled) {
          return;
        }
        const next: DisplayedPhoto = {
          id: photo.id,
          blur,
          url,
          name: photo.name,
          photographerName: photo.photographerName,
          photographerProfileURL: photo.photographerProfileURL,
        };
        // True only while the commit runs inside a live view transition.
        // The fallbacks (no API, reduced motion, a skipped start) commit the
        // same way a normal swap does, keeping the CSS dissolve.
        let inkAnimating = false;
        const commit = () => {
          if (inkAnimating) {
            // The snapshot is the crossfade: park the CSS layers so they do
            // not re-animate when the view transition hands back the live DOM.
            setOutgoing(null);
            setSettledKey(displayedPhotoKey(next));
          } else {
            // Blur-only swaps held the old variant through the download;
            // crossfade it out now. Thread swaps already demoted theirs.
            const held = displayedRef.current;
            if (held !== null && held.id === next.id && held.blur !== next.blur) {
              setOutgoing(held);
            }
            // A normal commit always fades in; only ink-transition commits
            // mount settled (set above, cleared here on the next swap).
            setSettledKey(null);
          }
          setDisplayed(next);
          onPhotoDisplayedRef.current?.(photo);
        };
        if (appearanceCrossfadeRef.current) {
          // The view-transition callback must mutate the DOM before it
          // returns, so React's photo + ink state have to flush together.
          runSceneryInkTransition((animating) => {
            inkAnimating = animating;
            flushSync(commit);
          });
          return;
        }
        commit();
      },
      { once: true },
    );
    image.src = url;
    return () => {
      cancelled = true;
      image.removeAttribute("src");
    };
    // Photo identity and blur are the triggers; the rest is read fresh.
  }, [photoId, blur]);

  // Drop the underlay once its dissolve has finished.
  useEffect(() => {
    if (!outgoing) {
      return;
    }
    const timer = window.setTimeout(() => setOutgoing(null), SCENERY_SWAP_OUT_MS + 100);
    return () => window.clearTimeout(timer);
  }, [outgoing]);

  // The credit follows whatever is actually on screen: the settled photo, or
  // the outgoing one while its dissolve is still the only photo visible.
  const credited = displayed ?? outgoing;

  return (
    <>
      <div aria-hidden className="scenery-layer">
        <div className="scenery-layer__group">
          <div className="scenery-layer__gradient" style={{ background: gradientCss(seed) }} />
          {outgoing ? (
            <div
              // Keyed like the current photo: without it React reuses the
              // node when outgoing changes mid-dissolve, and the new photo
              // would inherit the previous one's half-finished fade.
              key={displayedPhotoKey(outgoing)}
              className="scenery-layer__photo scenery-layer__photo--outgoing"
              style={{ backgroundImage: `url(${outgoing.url})` }}
            />
          ) : null}
          {displayed ? (
            <div
              className={
                displayedPhotoKey(displayed) === settledKey
                  ? "scenery-layer__photo"
                  : "scenery-layer__photo scenery-layer__photo--current"
              }
              key={displayedPhotoKey(displayed)}
              style={{ backgroundImage: `url(${displayed.url})` }}
            />
          ) : null}
        </div>
        <div className="scenery-layer__wash scenery-layer__wash--dark" />
        <div className="scenery-layer__wash scenery-layer__wash--light" />
        <div className="scenery-layer__edges scenery-layer__edges--dark" />
        <div className="scenery-layer__edges scenery-layer__edges--light" />
      </div>
      {credited ? (
        // Outside the aria-hidden art layer: the credit is real content, and
        // its links need a stacking slot above the (transparent) chat column.
        // The location collapses before the required photo credit at narrow
        // widths. CSS aligns this with the settings trigger as one short dock
        // in a bottom strip the composer overlay is padded away from, so the
        // dock never sits on top of the chat box.
        <div className="scenery-attribution">
          <span className="scenery-attribution__name">{credited.name}</span>
          <span className="scenery-attribution__separator" aria-hidden>
            {" · "}
          </span>
          <span className="scenery-attribution__credit">
            <span className="scenery-attribution__prefix">Photo by </span>
            {credited.photographerProfileURL ? (
              <a
                className="scenery-attribution__photographer"
                href={`${credited.photographerProfileURL}${UNSPLASH_UTM}`}
                rel="noreferrer"
                target="_blank"
              >
                {credited.photographerName}
              </a>
            ) : (
              <span className="scenery-attribution__photographer">{credited.photographerName}</span>
            )}
            <span className="scenery-attribution__prefix"> on </span>
            <a href={`https://unsplash.com/${UNSPLASH_UTM}`} rel="noreferrer" target="_blank">
              Unsplash
            </a>
          </span>
        </div>
      ) : null}
    </>
  );
}
