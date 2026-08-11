import { isWorkspaceImagePreviewPath } from "./filePreview.ts";

export const PROJECT_FAVICON_FALLBACK_MARKER = "project-favicon-missing";

/** Stored `faviconPath` prefix for icons copied into T3 home instead of the repo. */
export const MANAGED_PROJECT_FAVICON_PREFIX = "t3-project-icon/";

const MANAGED_PROJECT_FAVICON_FILE_NAME_MAX_LENGTH = 255;

export function getProjectFaviconCacheKey(
  environmentId: string,
  workspaceRoot: string,
  url: string,
) {
  let revision = url;

  try {
    const pathname = new URL(url, "https://t3.invalid").pathname;
    revision = pathname.slice(pathname.lastIndexOf("/") + 1);
  } catch {
    // Keep the full value as a safe fallback for malformed URLs.
  }

  return JSON.stringify([environmentId, workspaceRoot, revision]);
}

export function isProjectFaviconFallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  try {
    const pathname = new URL(url, "https://t3.invalid").pathname;
    return pathname.slice(pathname.lastIndexOf("/") + 1) === PROJECT_FAVICON_FALLBACK_MARKER;
  } catch {
    return false;
  }
}

export function isManagedProjectFaviconPath(path: string): boolean {
  return (
    path.startsWith(MANAGED_PROJECT_FAVICON_PREFIX) &&
    !path.includes("\\") &&
    !path.slice(MANAGED_PROJECT_FAVICON_PREFIX.length).includes("/") &&
    isWorkspaceImagePreviewPath(path)
  );
}

export function managedProjectFaviconFileName(path: string): string | null {
  if (!isManagedProjectFaviconPath(path)) return null;
  return path.slice(MANAGED_PROJECT_FAVICON_PREFIX.length);
}

/**
 * Build the stored project-icon path for a user-picked file. The original
 * basename is kept for display; the server stores bytes under T3 home keyed
 * by project id, so this string never points at the source file.
 */
export function toManagedProjectFaviconPath(fileName: string): string | null {
  const base = fileName.replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  if (base.includes("\0") || base.includes("..")) return null;
  if (!isWorkspaceImagePreviewPath(base)) return null;

  const extensionIndex = base.lastIndexOf(".");
  const stem = base
    .slice(0, extensionIndex)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MANAGED_PROJECT_FAVICON_FILE_NAME_MAX_LENGTH);
  const extension = base.slice(extensionIndex).toLowerCase();
  const safeStem = stem.length > 0 ? stem : "icon";
  const managed = `${MANAGED_PROJECT_FAVICON_PREFIX}${safeStem}${extension}`;
  return isManagedProjectFaviconPath(managed) ? managed : null;
}
