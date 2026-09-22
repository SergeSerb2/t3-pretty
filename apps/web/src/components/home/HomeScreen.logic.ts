/**
 * Home-screen helpers that stay out of the React tree so they can be tested
 * without rendering cards.
 */

/**
 * Last "Start in" project for this environment, or the first sidebar project
 * when nothing is remembered or the remembered id is gone.
 */
export function resolveExploreProjectId(
  rememberedId: string | null | undefined,
  projectIds: ReadonlyArray<string>,
): string | null {
  if (rememberedId !== null && rememberedId !== undefined && projectIds.includes(rememberedId)) {
    return rememberedId;
  }
  return projectIds[0] ?? null;
}

export function rememberExploreProjectId(
  current: Readonly<Record<string, string>>,
  environmentId: string,
  projectId: string,
): Record<string, string> {
  if (current[environmentId] === projectId) {
    return current as Record<string, string>;
  }
  return { ...current, [environmentId]: projectId };
}
