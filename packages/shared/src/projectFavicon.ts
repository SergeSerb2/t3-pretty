import { isWorkspaceImagePreviewPath } from "./filePreview.ts";

export const PROJECT_FAVICON_FALLBACK_MARKER = "project-favicon-missing";

/** Stored `faviconPath` prefix for icons copied into T3 home instead of the repo. */
export const MANAGED_PROJECT_FAVICON_PREFIX = "t3-project-icon/";

/** Hex SHA-256 prefix stored in the managed path so replacements bust client caches. */
export const MANAGED_PROJECT_FAVICON_REVISION_LENGTH = 16;

const MANAGED_PROJECT_FAVICON_FILE_NAME_MAX_LENGTH = 255;
const MANAGED_PROJECT_FAVICON_REVISION_RE = new RegExp(
  `^[0-9a-f]{${MANAGED_PROJECT_FAVICON_REVISION_LENGTH}}$`,
);

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

export function parseManagedProjectFaviconPath(path: string): {
  readonly revision: string;
  readonly fileName: string;
  readonly extension: string;
} | null {
  if (!isManagedProjectFaviconPath(path)) return null;
  const rest = path.slice(MANAGED_PROJECT_FAVICON_PREFIX.length);
  const extensionIndex = rest.lastIndexOf(".");
  if (extensionIndex <= 0) return null;
  const extension = rest.slice(extensionIndex).toLowerCase();
  const name = rest.slice(0, extensionIndex);
  const separatorIndex = name.indexOf("-");
  if (separatorIndex !== MANAGED_PROJECT_FAVICON_REVISION_LENGTH) return null;
  const revision = name.slice(0, separatorIndex);
  const stem = name.slice(separatorIndex + 1);
  if (!MANAGED_PROJECT_FAVICON_REVISION_RE.test(revision) || stem.length === 0) return null;
  return { revision, fileName: `${stem}${extension}`, extension };
}

export function managedProjectFaviconFileName(path: string): string | null {
  return parseManagedProjectFaviconPath(path)?.fileName ?? null;
}

/**
 * Build the stored project-icon path for a user-picked file. The original
 * basename is kept for display; `revision` versions the path so a replacement
 * with the same name busts the client asset cache. The server stores bytes
 * under T3 home keyed by project id, so this string never points at the source
 * file.
 */
export function toManagedProjectFaviconPath(fileName: string, revision: string): string | null {
  if (!MANAGED_PROJECT_FAVICON_REVISION_RE.test(revision)) return null;
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
  const managed = `${MANAGED_PROJECT_FAVICON_PREFIX}${revision}-${safeStem}${extension}`;
  return parseManagedProjectFaviconPath(managed) ? managed : null;
}
