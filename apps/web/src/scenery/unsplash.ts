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

interface UnsplashSearchResult {
  readonly id: string;
  readonly color?: string | null;
  readonly plus?: unknown;
  readonly premium?: boolean | null;
  readonly urls: { readonly raw: string; readonly regular: string; readonly thumb: string };
  readonly links?: { readonly download_location?: string | null } | null;
  readonly user: {
    readonly name: string;
    readonly links?: { readonly html?: string | null } | null;
  };
}

/**
 * Build-time key with a runtime localStorage override. null when absent —
 * callers must degrade to the seed pool + gradient washes.
 */
export function resolveUnsplashAccessKey(): string | null {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(UNSPLASH_KEY_STORAGE_KEY);
      if (typeof stored === "string" && stored.trim().length > 0) {
        return stored.trim();
      }
    } catch {
      // Storage unavailable; fall through to the build-time key.
    }
  }
  const fromEnv = import.meta.env.VITE_SCENERY_UNSPLASH_KEY as string | undefined;
  return typeof fromEnv === "string" && fromEnv.length > 0 ? fromEnv : null;
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
  if (accessKey === null || accessKey.length === 0) {
    return null;
  }
  const headers = {
    Authorization: `Client-ID ${accessKey}`,
    "Accept-Version": "v1",
  };
  return {
    searchPhotos: async (query, count) => {
      const params = new URLSearchParams({
        query,
        per_page: String(count),
        orientation: "landscape",
        content_filter: "high",
      });
      const response = await fetchFn(`https://api.unsplash.com/search/photos?${params}`, {
        headers,
      });
      if (!response.ok) {
        throw new Error(`Unsplash search failed with status ${response.status}`);
      }
      const body = (await response.json()) as { results?: ReadonlyArray<UnsplashSearchResult> };
      return (body.results ?? [])
        .filter((photo) => !photo.plus && photo.premium !== true)
        .map((photo) => ({
          id: photo.id,
          // Placeholder; the store pairs the curated location name at pool build.
          name: "",
          averageColorHex: photo.color ?? null,
          heroURL: photo.urls.regular,
          thumbURL: photo.urls.thumb,
          rawURL: photo.urls.raw,
          downloadLocationURL: photo.links?.download_location ?? null,
          photographerName: photo.user.name,
          photographerProfileURL: photo.user.links?.html ?? null,
        }));
    },
    registerDownload: async (downloadLocationURL) => {
      try {
        const response = await fetchFn(downloadLocationURL, { headers });
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
    return url;
  }
  for (const param of SIZING_PARAMS) {
    parsed.searchParams.delete(param);
  }
  parsed.searchParams.set("w", String(options.width));
  parsed.searchParams.set("q", "85");
  parsed.searchParams.set("fm", "jpg");
  parsed.searchParams.set("fit", "max");
  if (options.blur !== undefined && options.blur > 0) {
    parsed.searchParams.set("blur", String(options.blur));
  }
  if (options.saturation !== undefined && options.saturation !== 0) {
    parsed.searchParams.set("sat", String(options.saturation));
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
