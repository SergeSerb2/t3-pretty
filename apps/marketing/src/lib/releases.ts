const REPO = "SergeSerb2/t3-pretty";

export const RELEASES_URL = `https://github.com/${REPO}/releases`;

const STABLE_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const PRERELEASE_API_URL = `https://api.github.com/repos/${REPO}/releases`;
const CACHE_KEY = "t3code-latest-release";
const NIGHTLY_CACHE_KEY = "t3code-latest-nightly";

// Mirror check-nightly-release.cjs isNightlyTag, but also match unprefixed versions.
// Tags from GitHub: vX.Y.Z-nightly.* or nightly-v*
// Also accept: X.Y.Z-nightly.* (unprefixed modern format)
const isNightlyTag = (tag: string): boolean =>
  /^v?\d+\.\d+\.\d+-nightly\./.test(tag) || tag.startsWith("nightly-v");
const RELEASE_CACHE_MAX_AGE_MS = 15 * 60 * 1_000;
const RELEASE_REQUEST_TIMEOUT_MS = 10_000;
const RELEASE_RESPONSE_MAX_BYTES = 1024 * 1024;
const RELEASE_ASSET_MAX_COUNT = 256;
const RELEASE_TAG_MAX_LENGTH = 128;
const RELEASE_ASSET_NAME_MAX_LENGTH = 512;
const RELEASE_URL_MAX_LENGTH = 2_048;

interface CachedRelease {
  readonly cachedAt: number;
  readonly release: Release;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

function isCanonicalGitHubUrl(value: unknown, pathnamePrefix: string): value is string {
  if (!isBoundedText(value, RELEASE_URL_MAX_LENGTH)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname.startsWith(pathnamePrefix)
    );
  } catch {
    return false;
  }
}

export function decodeRelease(value: unknown): Release | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (!isBoundedText(candidate.tag_name, RELEASE_TAG_MAX_LENGTH)) return null;
  if (
    !isCanonicalGitHubUrl(candidate.html_url, `/${REPO}/releases/tag/`) ||
    !Array.isArray(candidate.assets) ||
    candidate.assets.length > RELEASE_ASSET_MAX_COUNT
  ) {
    return null;
  }

  const assets: ReleaseAsset[] = [];
  for (const value of candidate.assets) {
    if (typeof value !== "object" || value === null) return null;
    const asset = value as Record<string, unknown>;
    if (
      !isBoundedText(asset.name, RELEASE_ASSET_NAME_MAX_LENGTH) ||
      !isCanonicalGitHubUrl(asset.browser_download_url, `/${REPO}/releases/download/`)
    ) {
      return null;
    }
    assets.push({
      name: asset.name,
      browser_download_url: asset.browser_download_url,
    });
  }

  return {
    tag_name: candidate.tag_name,
    html_url: candidate.html_url,
    assets,
  };
}

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function readCachedRelease(now: number, cacheKey: string): {
  readonly fresh: Release | null;
  readonly stale: Release | null;
} {
  const store = storage();
  if (!store) return { fresh: null, stale: null };

  try {
    const raw = store.getItem(cacheKey);
    if (raw === null) return { fresh: null, stale: null };
    if (raw.length > RELEASE_RESPONSE_MAX_BYTES) {
      store.removeItem(cacheKey);
      return { fresh: null, stale: null };
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "release" in parsed) {
      const candidate = parsed as Partial<CachedRelease>;
      const release = decodeRelease(candidate.release);
      if (
        release &&
        typeof candidate.cachedAt === "number" &&
        Number.isFinite(candidate.cachedAt)
      ) {
        const age = now - candidate.cachedAt;
        return {
          fresh: age >= 0 && age <= RELEASE_CACHE_MAX_AGE_MS ? release : null,
          stale: release,
        };
      }
    } else {
      // Releases cached by older versions remain useful as a stale fallback.
      const release = decodeRelease(parsed);
      if (release) return { fresh: null, stale: release };
    }

    store.removeItem(cacheKey);
  } catch {
    try {
      store.removeItem(cacheKey);
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }
  return { fresh: null, stale: null };
}

function writeCachedRelease(release: Release, cachedAt: number, cacheKey: string): void {
  try {
    storage()?.setItem(cacheKey, JSON.stringify({ cachedAt, release } satisfies CachedRelease));
  } catch {
    // Downloads should continue to work when session storage is unavailable.
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > RELEASE_RESPONSE_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Latest release response is too large");
  }
  if (!response.body) throw new Error("Latest release response has no body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > RELEASE_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Latest release response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function fetchReleaseFromUrl(
  url: string,
  cacheKey: string,
): Promise<Release> {
  const now = Date.now();
  const cached = readCachedRelease(now, cacheKey);
  if (cached.fresh) return cached.fresh;

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), RELEASE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Release request failed (${response.status})`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBoundedResponse(response));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Release response was not JSON", { cause: error });
      }
      throw error;
    }
    const release = decodeRelease(parsed);
    if (!release) throw new Error("Release response was invalid");

    writeCachedRelease(release, now, cacheKey);
    return release;
  } catch (error) {
    if (cached.stale) return cached.stale;
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export type ReleaseChannel = "stable" | "nightly";

export async function fetchLatestRelease(channel: ReleaseChannel = "stable"): Promise<Release> {
  return channel === "nightly" ? fetchLatestNightlyRelease() : fetchReleaseFromUrl(STABLE_API_URL, CACHE_KEY);
}

export async function fetchLatestNightlyRelease(): Promise<Release> {
  // Mirror check-nightly-release.cjs findLatestNightly:
  // Fetch releases (paginate if needed), skip drafts, require published_at,
  // filter nightly tags, sort by published_at desc, pick newest
  const now = Date.now();
  const cached = readCachedRelease(now, NIGHTLY_CACHE_KEY);
  if (cached.fresh) return cached.fresh;

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), RELEASE_REQUEST_TIMEOUT_MS);
  try {
    // Fetch enough pages to cover typical nightly density; GitHub default is 30/page
    const response = await fetch(`${PRERELEASE_API_URL}?per_page=100`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Prerelease list request failed (${response.status})`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBoundedResponse(response));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Prerelease list response was not JSON", { cause: error });
      }
      throw error;
    }

    if (!Array.isArray(parsed)) throw new Error("Prerelease list was not an array");
    
    // Filter: !draft && published_at && isNightlyTag
    const candidates: Release[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        "draft" in item &&
        item.draft !== true &&
        "published_at" in item &&
        typeof item.published_at === "string"
      ) {
        const release = decodeRelease(item);
        if (release && isNightlyTag(release.tag_name)) {
          candidates.push(release);
        }
      }
    }

    if (candidates.length === 0) {
      throw new Error("No nightly release found in prerelease list");
    }

    // Sort by published_at descending and pick newest
    candidates.sort((a, b) => {
      const timeA = Date.parse(a.published_at);
      const timeB = Date.parse(b.published_at);
      return timeB - timeA;
    });

    const newestNightly = candidates[0];
    writeCachedRelease(newestNightly, now, NIGHTLY_CACHE_KEY);
    return newestNightly;
  } catch (error) {
    if (cached.stale) return cached.stale;
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
