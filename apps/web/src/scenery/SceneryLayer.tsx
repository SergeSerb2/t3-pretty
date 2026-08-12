/**
 * The full-window scenery surface: gradient fallback, pre-blurred photo, and
 * legibility wash, stacked exactly like SurgeCode's WindowLayers. The scenery
 * group is isolated and fades as ONE layer (see glass.ts for why), the wash
 * carries text contrast, and the attribution pill satisfies the Unsplash
 * guidelines wherever a photo shows prominently.
 *
 * Anti-flash: the previously displayed photo is held until the next one has
 * decoded, so a thread switch cross-fades photo→photo instead of collapsing
 * to the gradient during the load gap. When the new photo also flips the
 * ink appearance, that commit is wrapped in a view transition so the
 * palette, wash, and wallpaper dissolve together.
 */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { gradientCss } from "./palette";
import { runSceneryInkTransition, SCENERY_INK_TRANSITION_MS } from "./sceneryInkTransition";
import { UNSPLASH_UTM, wallpaperURL, type SceneryPhoto } from "./unsplash";

interface DisplayedPhoto {
  readonly id: string;
  readonly blur: number;
  readonly url: string;
  readonly name: string;
  readonly photographerName: string;
  readonly photographerProfileURL: string | null;
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
  const [previous, setPrevious] = useState<DisplayedPhoto | null>(null);
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
        const commit = () => {
          setPrevious(displayedRef.current);
          setDisplayed(next);
          onPhotoDisplayedRef.current?.(photo);
        };
        if (appearanceCrossfadeRef.current) {
          // The view-transition callback must mutate the DOM before it
          // returns, so React's photo + ink state have to flush together.
          runSceneryInkTransition(() => {
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
    };
    // Photo identity and blur are the triggers; the rest is read fresh.
  }, [photoId, blur]);

  // Drop the underlay once the crossfade has finished.
  useEffect(() => {
    if (!previous) {
      return;
    }
    const timer = window.setTimeout(() => setPrevious(null), SCENERY_INK_TRANSITION_MS + 100);
    return () => window.clearTimeout(timer);
  }, [previous]);

  return (
    <>
      <div aria-hidden className="scenery-layer">
        <div className="scenery-layer__group">
          <div className="scenery-layer__gradient" style={{ background: gradientCss(seed) }} />
          {previous ? (
            <div
              className="scenery-layer__photo"
              style={{ backgroundImage: `url(${previous.url})` }}
            />
          ) : null}
          {displayed ? (
            <div
              className="scenery-layer__photo scenery-layer__photo--current"
              key={`${displayed.id}@${displayed.blur}`}
              style={{ backgroundImage: `url(${displayed.url})` }}
            />
          ) : null}
        </div>
        <div className="scenery-layer__wash scenery-layer__wash--dark" />
        <div className="scenery-layer__wash scenery-layer__wash--light" />
        <div className="scenery-layer__edges scenery-layer__edges--dark" />
        <div className="scenery-layer__edges scenery-layer__edges--light" />
      </div>
      {displayed ? (
        // Outside the aria-hidden art layer: the credit is real content, and
        // its links need a stacking slot above the (transparent) chat column.
        // The location collapses before the required photo credit at narrow
        // widths. CSS aligns this with the settings trigger as one short dock
        // in a bottom strip the composer overlay is padded away from, so the
        // dock never sits on top of the chat box.
        <div className="scenery-attribution">
          <span className="scenery-attribution__name">{displayed.name}</span>
          <span className="scenery-attribution__separator" aria-hidden>
            {" · "}
          </span>
          <span className="scenery-attribution__credit">
            <span className="scenery-attribution__prefix">Photo by </span>
            {displayed.photographerProfileURL ? (
              <a
                className="scenery-attribution__photographer"
                href={`${displayed.photographerProfileURL}${UNSPLASH_UTM}`}
                rel="noreferrer"
                target="_blank"
              >
                {displayed.photographerName}
              </a>
            ) : (
              <span className="scenery-attribution__photographer">
                {displayed.photographerName}
              </span>
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
