import { serverSceneryMatchesPhotoSet } from "@t3tools/client-runtime/state/scenery-sync";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { DEFAULT_PHOTO_SET_ID, type PhotoSetId } from "../scenery/photoSets";
import type { SceneryAssignment, SceneryPhoto } from "../scenery/sceneryLogic";

/**
 * Thumbnail for a Home card: the photo the thread screen shows behind that
 * thread, from the active catalog only. A thread with no photo yet gets none
 * instead of the hash fallback, because opening it picks a photo at random and
 * the card would change under the user.
 */
export function resolveHomeCardSceneryThumb(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "scenery">,
  scenery: {
    readonly photoSetId: PhotoSetId;
    readonly assignments: Readonly<Record<string, SceneryAssignment>>;
    readonly photoForThreadKey: (threadKey: string) => SceneryPhoto | null;
  },
): string | null {
  const synced = thread.scenery ?? null;
  if (synced !== null && serverSceneryMatchesPhotoSet(synced.photoSetId, scenery.photoSetId)) {
    return synced.thumbURL;
  }
  const threadKey = `${thread.environmentId}:${thread.id}`;
  const assignment = scenery.assignments[threadKey];
  if (
    assignment === undefined ||
    (assignment.photoSetId ?? DEFAULT_PHOTO_SET_ID) !== scenery.photoSetId
  ) {
    return null;
  }
  // A pick that left the catalog resolves to the hash fallback, which opening
  // the thread replaces.
  const photo = scenery.photoForThreadKey(threadKey);
  return photo?.id === assignment.photoId ? photo.thumbURL : null;
}
