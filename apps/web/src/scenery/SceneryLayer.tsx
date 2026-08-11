/**
 * The full-window scenery surface: gradient fallback, pre-blurred photo, and
 * legibility wash, stacked exactly like SurgeCode's WindowLayers. The scenery
 * group is isolated and fades as ONE layer (see glass.ts for why), the wash
 * carries text contrast, and the attribution pill satisfies the Unsplash
 * guidelines wherever a photo shows prominently.
 *
 * Anti-flash: the previously displayed photo is held until the next one has
 * decoded, so a thread switch cross-fades photo→photo instead of collapsing
 * to the gradient during the load gap.
 */
import { useEffect, useRef, useState } from "react";

import { gradientCss } from "./palette";
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
  onPhotoDisplayed,
}: {
  photo: SceneryPhoto | null;
  /** Deterministic gradient seed (thread key or daily key). */
  seed: string;
  /** CDN pre-blur strength (0–100); a change cross-fades like a photo swap. */
  blur: number;
  onPhotoDisplayed?: (photo: SceneryPhoto) => void;
}) {
  const [displayed, setDisplayed] = useState<DisplayedPhoto | null>(null);
  const [previous, setPrevious] = useState<DisplayedPhoto | null>(null);

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
        setPrevious(displayedRef.current);
        setDisplayed({
          id: photo.id,
          blur,
          url,
          name: photo.name,
          photographerName: photo.photographerName,
          photographerProfileURL: photo.photographerProfileURL,
        });
        onPhotoDisplayed?.(photo);
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
    const timer = window.setTimeout(() => setPrevious(null), 400);
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
        <div className="scenery-layer__wash" />
        <div className="scenery-layer__edges" />
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
            ·
          </span>
          <span className="scenery-attribution__credit">
            <span className="scenery-attribution__prefix">Photo by</span>
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
            <span className="scenery-attribution__prefix">on</span>
            <a href={`https://unsplash.com/${UNSPLASH_UTM}`} rel="noreferrer" target="_blank">
              Unsplash
            </a>
          </span>
        </div>
      ) : null}
    </>
  );
}
