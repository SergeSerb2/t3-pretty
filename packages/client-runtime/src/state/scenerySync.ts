/**
 * Which scenery catalog and which thread photo connected devices should show.
 * The catalog is a shared server setting. A thread photo is stored on that
 * thread and replaced only when the catalog changes.
 */

export function resolveSharedSceneryPhotoSet(input: {
  readonly primaryEnvironmentId: string | null;
  readonly sources: ReadonlyArray<{
    readonly environmentId: string;
    readonly syncEligible: boolean;
    readonly sceneryPhotoSet: string | null | undefined;
  }>;
}): string | null {
  const eligible = input.sources.filter((source) => source.syncEligible);
  const primary = eligible.find((source) => source.environmentId === input.primaryEnvironmentId);
  const primaryValue = nonEmpty(primary?.sceneryPhotoSet);
  if (primaryValue !== null) return primaryValue;
  const others = eligible
    .filter((source) => source.environmentId !== input.primaryEnvironmentId)
    // `.sort()`, not `.toSorted()`: `.filter()` already returned a fresh array, and this
    // module is imported by mobile SceneryProvider on first paint. Hermes has no ES2023
    // array methods — calling `.toSorted()` throws TypeError and kills iOS launch.
    .sort((left, right) => left.environmentId.localeCompare(right.environmentId));
  for (const source of others) {
    const value = nonEmpty(source.sceneryPhotoSet);
    if (value !== null) return value;
  }
  return null;
}

/** Publish a device-local catalog only when no connected machine has chosen one. */
export function shouldPublishLocalSceneryPhotoSet(input: {
  readonly sharedPhotoSetId: string | null;
  readonly localPhotoSetId: string;
  readonly defaultPhotoSetId: string;
}): boolean {
  return input.sharedPhotoSetId === null && input.localPhotoSetId !== input.defaultPhotoSetId;
}

/**
 * A server photo with no catalog belongs to the original single-catalog
 * binding and still wins. A photo from another catalog does not.
 */
export function serverSceneryMatchesPhotoSet(
  assignedPhotoSetId: string | null | undefined,
  photoSetId: string,
): boolean {
  return (
    assignedPhotoSetId == null ||
    assignedPhotoSetId.length === 0 ||
    assignedPhotoSetId === photoSetId
  );
}

/**
 * Hold a local pick until this device is showing the catalog the account
 * has already published. Otherwise an older catalog would overwrite the
 * photo the other devices just agreed on.
 */
export function mayPublishThreadScenery(input: {
  readonly sharedPhotoSetId: string | null;
  readonly localPhotoSetId: string;
}): boolean {
  return input.sharedPhotoSetId === null || input.sharedPhotoSetId === input.localPhotoSetId;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
