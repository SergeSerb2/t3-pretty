import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const THREAD_SCENERY_PHOTO_ID_MAX_LENGTH = 512;
export const THREAD_SCENERY_NAME_MAX_LENGTH = 1_024;
export const THREAD_SCENERY_COLOR_MAX_LENGTH = 32;
export const THREAD_SCENERY_URL_MAX_LENGTH = 8_192;
export const THREAD_SCENERY_PHOTOGRAPHER_NAME_MAX_LENGTH = 2_048;
export const THREAD_SCENERY_PHOTO_SET_ID_MAX_LENGTH = 64;

const threadSceneryPhotoFields = {
  photoId: TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_SCENERY_PHOTO_ID_MAX_LENGTH)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_SCENERY_NAME_MAX_LENGTH)),
  averageColorHex: Schema.NullOr(
    TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_SCENERY_COLOR_MAX_LENGTH)),
  ),
  heroURL: TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_SCENERY_URL_MAX_LENGTH)),
  thumbURL: TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_SCENERY_URL_MAX_LENGTH)),
  rawURL: Schema.NullOr(
    TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_SCENERY_URL_MAX_LENGTH)),
  ),
  downloadLocationURL: Schema.NullOr(
    TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_SCENERY_URL_MAX_LENGTH)),
  ),
  photographerName: TrimmedNonEmptyString.check(
    Schema.isMaxLength(THREAD_SCENERY_PHOTOGRAPHER_NAME_MAX_LENGTH),
  ),
  photographerProfileURL: Schema.NullOr(
    TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_SCENERY_URL_MAX_LENGTH)),
  ),
} as const;

export const ThreadSceneryPhotoSetId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(THREAD_SCENERY_PHOTO_SET_ID_MAX_LENGTH),
);
export type ThreadSceneryPhotoSetId = typeof ThreadSceneryPhotoSetId.Type;

export const ThreadSceneryPhoto = Schema.Struct(threadSceneryPhotoFields);
export type ThreadSceneryPhoto = typeof ThreadSceneryPhoto.Type;

/**
 * What a client sends to bind a photo. The server stamps `assignedAt`.
 * `photoSetId` is the catalog the photo was picked from, so a later catalog
 * change can replace the binding instead of staying stuck on the first photo.
 */
export const ThreadSceneryAssignRequest = Schema.Struct({
  ...threadSceneryPhotoFields,
  photoSetId: Schema.optional(ThreadSceneryPhotoSetId),
});
export type ThreadSceneryAssignRequest = typeof ThreadSceneryAssignRequest.Type;

export const ThreadSceneryAssignment = Schema.Struct({
  ...threadSceneryPhotoFields,
  photoSetId: Schema.optional(ThreadSceneryPhotoSetId),
  assignedAt: IsoDateTime,
});
export type ThreadSceneryAssignment = typeof ThreadSceneryAssignment.Type;
