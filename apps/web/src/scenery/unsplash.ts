/**
 * Minimal Unsplash REST client (search + download registration), ported from
 * SurgeCode v0.2.7. Read-only public endpoints, so only the access key is
 * needed. The key arrives at build time via VITE_SCENERY_UNSPLASH_KEY (the
 * fork's build script reads it from the SurgeCode key file) with a runtime
 * localStorage override; it is never committed. Without a key every caller
 * degrades to gradient washes — the bundled seed pool keeps photos working
 * regardless.
 */

/** utm_source value Unsplash attribution links must carry. */
export const UNSPLASH_APP_NAME = "SurgeCode";
export const UNSPLASH_UTM = `?utm_source=${UNSPLASH_APP_NAME}&utm_medium=referral`;

export const UNSPLASH_KEY_STORAGE_KEY = "t3code:scenery:unsplash-key";

/** A stalled CDN/API request must not block scenery refreshes indefinitely. */
export const UNSPLASH_REQUEST_TIMEOUT_MS = 15_000;
export const UNSPLASH_SEARCH_QUERY_MAX_LENGTH = 256;
export const UNSPLASH_SEARCH_MAX_COUNT = 30;
const UNSPLASH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const UNSPLASH_ACCESS_KEY_MAX_LENGTH = 256;
const UNSPLASH_URL_MAX_LENGTH = 2_048;
const UNSPLASH_ID_MAX_LENGTH = 128;
const UNSPLASH_NAME_MAX_LENGTH = 256;

async function withRequestTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UNSPLASH_REQUEST_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * One photo from the Unsplash API, reduced to the fields the scenery system
 * needs. Persisted (seed pool + store), so keep the shape stable — it matches
 * SurgeCode's pool.json exactly.
 */
export interface SceneryPhoto {
  readonly id: string;
  /** Curated "Location, Country" display name paired at pool build. */
  readonly name: string;
  /** Average color reported by Unsplash ("#RRGGBB"); wash while loading. */
  readonly averageColorHex: string | null;
  /** `urls.regular` (1080w) — fallback when rawURL is absent. */
  readonly heroURL: string;
  /** `urls.thumb` (~200w) — thumbnails. */
  readonly thumbURL: string;
  /** Unprocessed base image (`urls.raw`); sized via imgix params. */
  readonly rawURL: string | null;
  /** `links.download_location` — pinged once when the photo is used. */
  readonly downloadLocationURL: string | null;
  readonly photographerName: string;
  readonly photographerProfileURL: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function safeHttpsUrl(value: unknown, allowedHosts?: ReadonlySet<string>): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > UNSPLASH_URL_MAX_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      (allowedHosts && !allowedHosts.has(url.hostname.toLowerCase()))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

const UNSPLASH_IMAGE_HOSTS = new Set(["images.unsplash.com", "plus.unsplash.com"]);
const UNSPLASH_PROFILE_HOSTS = new Set(["unsplash.com", "www.unsplash.com"]);
const UNSPLASH_API_HOSTS = new Set(["api.unsplash.com"]);

export function trustedUnsplashDownloadUrl(value: unknown): string | null {
  const urlValue = safeHttpsUrl(value, UNSPLASH_API_HOSTS);
  if (!urlValue) return null;
  const url = new URL(urlValue);
  return /^\/photos\/[^/]{1,128}\/download$/.test(url.pathname) && !url.hash
    ? url.toString()
    : null;
}

export function unsplashProfileAttributionUrl(value: unknown): string | null {
  const urlValue = safeHttpsUrl(value, UNSPLASH_PROFILE_HOSTS);
  if (!urlValue) return null;
  const url = new URL(urlValue);
  url.searchParams.set("utm_source", UNSPLASH_APP_NAME);
  url.searchParams.set("utm_medium", "referral");
  return url.toString();
}

/** Normalize photo data before it enters persisted or server-synced scenery state. */
export function sanitizeSceneryPhoto(value: unknown): SceneryPhoto | null {
  if (!isRecord(value)) return null;
  const id = boundedString(value.id, UNSPLASH_ID_MAX_LENGTH);
  const name = boundedString(value.name, UNSPLASH_NAME_MAX_LENGTH);
  const heroURL = safeHttpsUrl(value.heroURL, UNSPLASH_IMAGE_HOSTS);
  const thumbURL = safeHttpsUrl(value.thumbURL, UNSPLASH_IMAGE_HOSTS);
  const photographerName = boundedString(value.photographerName, UNSPLASH_NAME_MAX_LENGTH);
  if (!id || !name || !heroURL || !thumbURL || !photographerName) return null;
  if (id.trim() !== id || name.trim() !== name || photographerName.trim() !== photographerName) {
    return null;
  }

  const rawURL = value.rawURL === null ? null : safeHttpsUrl(value.rawURL, UNSPLASH_IMAGE_HOSTS);
  const downloadLocationURL =
    value.downloadLocationURL === null
      ? null
      : trustedUnsplashDownloadUrl(value.downloadLocationURL);
  const photographerProfileURL =
    value.photographerProfileURL === null
      ? null
      : safeHttpsUrl(value.photographerProfileURL, UNSPLASH_PROFILE_HOSTS);
  if (
    (value.rawURL !== null && !rawURL) ||
    (value.downloadLocationURL !== null && !downloadLocationURL) ||
    (value.photographerProfileURL !== null && !photographerProfileURL)
  ) {
    return null;
  }

  const averageColorHex =
    value.averageColorHex === null ||
    (typeof value.averageColorHex === "string" && /^#[0-9a-f]{6}$/i.test(value.averageColorHex))
      ? value.averageColorHex
      : undefined;
  if (averageColorHex === undefined) return null;
  return {
    id,
    name,
    averageColorHex,
    heroURL,
    thumbURL,
    rawURL,
    downloadLocationURL,
    photographerName,
    photographerProfileURL,
  };
}

function decodeSearchPhoto(value: unknown): SceneryPhoto | null {
  if (!isRecord(value) || !isRecord(value.urls) || !isRecord(value.user)) return null;
  if (value.plus || value.premium === true) return null;
  const id = boundedString(value.id, UNSPLASH_ID_MAX_LENGTH);
  const heroURL = safeHttpsUrl(value.urls.regular, UNSPLASH_IMAGE_HOSTS);
  const thumbURL = safeHttpsUrl(value.urls.thumb, UNSPLASH_IMAGE_HOSTS);
  const rawURL = safeHttpsUrl(value.urls.raw, UNSPLASH_IMAGE_HOSTS);
  const photographerName = boundedString(value.user.name, UNSPLASH_NAME_MAX_LENGTH);
  if (!id || !heroURL || !thumbURL || !rawURL || !photographerName) return null;

  const links = isRecord(value.links) ? value.links : null;
  const userLinks = isRecord(value.user.links) ? value.user.links : null;
  return {
    id,
    name: "",
    averageColorHex:
      typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : null,
    heroURL,
    thumbURL,
    rawURL,
    downloadLocationURL: trustedUnsplashDownloadUrl(links?.download_location),
    photographerName,
    photographerProfileURL: safeHttpsUrl(userLinks?.html, UNSPLASH_PROFILE_HOSTS),
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > UNSPLASH_RESPONSE_MAX_BYTES) {
    throw new Error("Unsplash returned an unexpectedly large response.");
  }
  if (!response.body) throw new Error("Unsplash returned an empty response.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > UNSPLASH_RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Unsplash returned an unexpectedly large response.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (cause) {
    throw new Error("Unsplash returned an unreadable response.", { cause });
  }
}

/**
 * Build-time key with a runtime localStorage override. null when absent —
 * callers must degrade to the seed pool + gradient washes.
 */
export function resolveUnsplashAccessKey(): string | null {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(UNSPLASH_KEY_STORAGE_KEY);
      const key = normalizeAccessKey(stored);
      if (key) {
        return key;
      }
    } catch {
      // Storage unavailable; fall through to the build-time key.
    }
  }
  const fromEnv = import.meta.env.VITE_SCENERY_UNSPLASH_KEY as string | undefined;
  return normalizeAccessKey(fromEnv);
}

function normalizeAccessKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key.length <= UNSPLASH_ACCESS_KEY_MAX_LENGTH && /^[A-Za-z0-9_-]+$/.test(key) ? key : null;
}

export interface UnsplashClient {
  readonly searchPhotos: (query: string, count: number) => Promise<ReadonlyArray<SceneryPhoto>>;
  /**
   * Ping `links.download_location` — required by the Unsplash guidelines
   * whenever a photo is put to use. Resolves true only when the ping landed,
   * so callers persist the claim only on success; failures are benign.
   */
  readonly registerDownload: (downloadLocationURL: string) => Promise<boolean>;
}

/** null when no key is configured. */
export function makeUnsplashClient(
  accessKey: string | null = resolveUnsplashAccessKey(),
  fetchFn: typeof fetch = fetch,
): UnsplashClient | null {
  const normalizedAccessKey = normalizeAccessKey(accessKey);
  if (!normalizedAccessKey) {
    return null;
  }
  const headers = {
    Authorization: `Client-ID ${normalizedAccessKey}`,
    "Accept-Version": "v1",
  };
  return {
    searchPhotos: async (query, count) => {
      const searchQuery = query.trim();
      if (!searchQuery || count <= 0) return [];
      if (searchQuery.length > UNSPLASH_SEARCH_QUERY_MAX_LENGTH) {
        throw new Error("Unsplash search terms must be 256 characters or fewer.");
      }
      const resultCount = Number.isFinite(count)
        ? Math.min(UNSPLASH_SEARCH_MAX_COUNT, Math.max(1, Math.floor(count)))
        : UNSPLASH_SEARCH_MAX_COUNT;
      return withRequestTimeout(async (signal) => {
        const params = new URLSearchParams({
          query: searchQuery,
          per_page: String(resultCount),
          orientation: "landscape",
          content_filter: "high",
        });
        const response = await fetchFn(`https://api.unsplash.com/search/photos?${params}`, {
          headers,
          signal,
        });
        if (!response.ok) {
          throw new Error(`Unsplash search failed with status ${response.status}`);
        }
        const body = await readBoundedJson(response);
        if (!isRecord(body) || !Array.isArray(body.results)) {
          throw new Error("Unsplash returned an unreadable response.");
        }
        return body.results.slice(0, resultCount).flatMap((photo) => {
          const decoded = decodeSearchPhoto(photo);
          return decoded ? [decoded] : [];
        });
      });
    },
    registerDownload: async (downloadLocationURL) => {
      const trustedUrl = trustedUnsplashDownloadUrl(downloadLocationURL);
      if (!trustedUrl) return false;
      try {
        const response = await withRequestTimeout((signal) =>
          fetchFn(trustedUrl, { headers, signal }),
        );
        return response.ok;
      } catch {
        // Guideline ping only; never surface failures.
        return false;
      }
    },
  };
}

const SIZING_PARAMS = ["w", "h", "q", "fm", "fit", "crop", "blur", "sat"];

/**
 * Rewrites an Unsplash/imgix URL to a specific render width (and optional
 * pre-blur/saturation): replaces any existing sizing params, keeps identity
 * params (ixid) intact. `fit=max` never upscales past the original asset.
 * Pre-blur on the CDN replaces a runtime gaussian — deterministic and free
 * on-device. `saturation` (imgix `sat`, -100..100) mirrors the mac chat
 * wallpaper's `.saturation(1.05)` boost.
 */
export function sizedImageURL(
  url: string,
  options: { width: number; blur?: number; saturation?: number },
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return "";
  }
  for (const param of SIZING_PARAMS) {
    parsed.searchParams.delete(param);
  }
  const width = Number.isFinite(options.width)
    ? Math.min(WALLPAPER_SHARP_CAP, Math.max(1, Math.round(options.width)))
    : WALLPAPER_BLURRED_CAP;
  parsed.searchParams.set("w", String(width));
  parsed.searchParams.set("q", "85");
  parsed.searchParams.set("fm", "jpg");
  parsed.searchParams.set("fit", "max");
  if (options.blur !== undefined && Number.isFinite(options.blur) && options.blur > 0) {
    parsed.searchParams.set("blur", String(Math.min(100, Math.round(options.blur))));
  }
  if (
    options.saturation !== undefined &&
    Number.isFinite(options.saturation) &&
    options.saturation !== 0
  ) {
    parsed.searchParams.set(
      "sat",
      String(Math.min(100, Math.max(-100, Math.round(options.saturation)))),
    );
  }
  return parsed.toString();
}

const WALLPAPER_SHARP_CAP = 3840;
const WALLPAPER_BLURRED_CAP = 1280;

/**
 * Render width for the wallpaper: the window's device-pixel width, rounded
 * up to a 256px step so the CDN cache stays warm. Pre-blurred photos
 * (`blur >= 20`) cap at 1280; sharp mode keeps the 3840 hero cap.
 */
export function wallpaperPixelWidth(blur = 50): number {
  if (typeof window === "undefined") {
    return blur >= 20 ? WALLPAPER_BLURRED_CAP : 2048;
  }
  const raw = Math.ceil(
    (window.innerWidth || window.screen?.width || 1728) * (window.devicePixelRatio || 1),
  );
  const cap = blur >= 20 ? WALLPAPER_BLURRED_CAP : WALLPAPER_SHARP_CAP;
  return Math.min(cap, Math.ceil(raw / 256) * 256);
}

/**
 * The pre-blurred wallpaper variant: replaces SurgeCode mac's runtime
 * `.blur(4).saturation(1.05)` bake with the CDN equivalent it shipped on
 * mobile (`blur=50&sat=5` by default), at zero on-device cost. The blur is
 * user-adjustable (0–100); 0 drops the param for the sharp original.
 */
export function wallpaperURL(photo: SceneryPhoto, blur = 50): string {
  const base = photo.rawURL ?? photo.heroURL;
  return sizedImageURL(base, { width: wallpaperPixelWidth(blur), blur, saturation: 5 });
}
