/**
 * Location name + required Unsplash credit, portaled below the chat box.
 * Replaces the bottom-right dock pill while a thread view is open.
 */
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { getSceneryPlaceSlot, subscribeSceneryPlaceSlot } from "./sceneryPlaceSlot";
import { UNSPLASH_UTM, type SceneryPhoto } from "./unsplash";

export function SceneryPlaceCredit({ photo }: { readonly photo: SceneryPhoto | null }) {
  const slot = useSyncExternalStore(subscribeSceneryPlaceSlot, getSceneryPlaceSlot, () => null);
  if (slot === null || photo === null) {
    return null;
  }

  return createPortal(
    <div className="scenery-place">
      <p className="scenery-place__name" data-scenery-place-name="">
        {photo.name}
      </p>
      <p className="scenery-place__credit">
        <span className="scenery-place__prefix">Photo by </span>
        {photo.photographerProfileURL ? (
          <a
            className="scenery-place__photographer"
            href={`${photo.photographerProfileURL}${UNSPLASH_UTM}`}
            rel="noreferrer"
            target="_blank"
          >
            {photo.photographerName}
          </a>
        ) : (
          <span className="scenery-place__photographer">{photo.photographerName}</span>
        )}
        <span className="scenery-place__prefix"> on </span>
        <a href={`https://unsplash.com/${UNSPLASH_UTM}`} rel="noreferrer" target="_blank">
          Unsplash
        </a>
      </p>
    </div>,
    slot,
  );
}
