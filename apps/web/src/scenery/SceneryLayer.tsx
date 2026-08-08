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
  readonly url: string;
  readonly name: string;
  readonly photographerName: string;
  readonly photographerProfileURL: string | null;
}

export function SceneryLayer({
  photo,
  seed,
  onPhotoDisplayed,
}: {
  photo: SceneryPhoto | null;
  /** Deterministic gradient seed (thread key or daily key). */
  seed: string;
  onPhotoDisplayed?: (photoId: string) => void;
}) {
  const [displayed, setDisplayed] = useState<DisplayedPhoto | null>(null);
  const [previous, setPrevious] = useState<DisplayedPhoto | null>(null);

  const displayedRef = useRef<DisplayedPhoto | null>(null);
  displayedRef.current = displayed;

  const photoId = photo?.id ?? null;
  useEffect(() => {
    if (!photo || photoId === null || displayedRef.current?.id === photoId) {
      return;
    }
    const url = wallpaperURL(photo);
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
          url,
          name: photo.name,
          photographerName: photo.photographerName,
          photographerProfileURL: photo.photographerProfileURL,
        });
        onPhotoDisplayed?.(photo.id);
      },
      { once: true },
    );
    image.src = url;
    return () => {
      cancelled = true;
    };
    // The photo identity is the only trigger; the rest is read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId]);

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
              key={displayed.id}
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
        <div className="scenery-attribution">
          <span className="scenery-attribution__name">{displayed.name}</span>
          <span className="scenery-attribution__credit">
            Photo by{" "}
            {displayed.photographerProfileURL ? (
              <a
                href={`${displayed.photographerProfileURL}${UNSPLASH_UTM}`}
                rel="noreferrer"
                target="_blank"
              >
                {displayed.photographerName}
              </a>
            ) : (
              displayed.photographerName
            )}{" "}
            on{" "}
            <a href={`https://unsplash.com/${UNSPLASH_UTM}`} rel="noreferrer" target="_blank">
              Unsplash
            </a>
          </span>
        </div>
      ) : null}
    </>
  );
}
