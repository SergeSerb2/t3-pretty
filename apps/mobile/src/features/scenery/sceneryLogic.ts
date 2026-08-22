/**
 * World Scenery engine for mobile: per-thread photo assignment, deterministic
 * fallbacks, and the glass-layer math. Ported bit-for-bit from the desktop
 * theme (apps/web/src/scenery, itself a SurgeCode v0.2.7 port) so a thread key
 * buckets to the same gradient/photo index on every surface, and the bundled
 * seed pool stays interchangeable with the web one (pinned by
 * sceneryLogic.test.ts).
 *
 * Mobile serves photos straight from the bundled seed pool; there is no live
 * Unsplash refresh on this surface yet. The CDN still pre-blurs the wallpaper
 * render (imgix `blur` param), so the device does no gaussian work.
 */
import { DEFAULT_PHOTO_SET_ID, type PhotoSetId } from "./photoSets";
import seedPoolJson from "./seedPool.json";

export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface GradientPair {
  readonly top: Rgb;
  readonly bottom: Rgb;
}

export function rgb(red: number, green: number, blue: number): Rgb {
  return { red, green, blue };
}

const clampChannel = (value: number): number => Math.min(255, Math.max(0, Math.round(value * 255)));

/** `rgba(r, g, b, a)` for React Native styles (no CSS `rgb(/ )` syntax). */
export function rgbaColor(color: Rgb, alpha = 1): string {
  const channels = [color.red, color.green, color.blue].map(clampChannel).join(", ");
  return `rgba(${channels}, ${alpha})`;
}

/**
 * Duotone washes sampled from Dolomites conditions: dawn limestone, glacier
 * melt, high meadow, larch dusk, scree, spruce shade. Same constants as the
 * web theme — a thread seeded here falls back to the same wash everywhere.
 */
export const dolomitesGradientPairs: ReadonlyArray<GradientPair> = [
  { top: rgb(0.93, 0.8, 0.71), bottom: rgb(0.56, 0.55, 0.62) },
  { top: rgb(0.73, 0.85, 0.87), bottom: rgb(0.42, 0.56, 0.64) },
  { top: rgb(0.72, 0.8, 0.58), bottom: rgb(0.36, 0.5, 0.4) },
  { top: rgb(0.89, 0.72, 0.51), bottom: rgb(0.47, 0.42, 0.5) },
  { top: rgb(0.82, 0.81, 0.78), bottom: rgb(0.52, 0.54, 0.55) },
  { top: rgb(0.55, 0.66, 0.56), bottom: rgb(0.25, 0.34, 0.32) },
];

const FNV_OFFSET_BASIS = 0xcbf2_9ce4_8422_2325n;
const FNV_PRIME = 0x0000_0100_0000_01b3n;
const U64_MASK = 0xffff_ffff_ffff_ffffn;

/**
 * FNV-1a over UTF-8, reduced mod `count`. `BigInt` masked to 64 bits matches
 * Swift's `UInt64` wrapping multiply exactly; a `Number`-based port cannot,
 * because the product overflows 2^53 on the first byte. The assignment has to
 * survive a relaunch, so per-launch-seeded hashes are out.
 */
export function stableIndex(seed: string, count: number): number {
  if (count <= 0) {
    return 0;
  }
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(seed)) {
    hash = (hash ^ BigInt(byte)) & U64_MASK;
    hash = (hash * FNV_PRIME) & U64_MASK;
  }
  return Number(hash % BigInt(count));
}

/**
 * Deterministic gradient pair for a seed (thread/photo id): the same entity
 * always falls back to the same wash across launches.
 */
export function gradientPair(seed: string): GradientPair {
  return dolomitesGradientPairs[stableIndex(seed, dolomitesGradientPairs.length)]!;
}

/**
 * One photo from the Unsplash API, reduced to the fields the scenery system
 * needs. Persisted (seed pool + preferences), so keep the shape stable — it
 * matches the web seedPool.json (and SurgeCode's pool.json) exactly.
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

export interface SceneryAssignment {
  readonly photoId: string;
  /** Curated "Location, Country" name, denormalized for display. */
  readonly name: string;
  readonly assignedAt: number;
  /** Which catalog this bind was picked from; absent on pre-theme-set records. */
  readonly photoSetId?: PhotoSetId;
}

/** utm_source value Unsplash attribution links must carry. */
export const UNSPLASH_APP_NAME = "SurgeCode";
export const UNSPLASH_UTM = `?utm_source=${UNSPLASH_APP_NAME}&utm_medium=referral`;

/** CDN pre-blur (imgix `blur`), 0–100. 50 is the SurgeCode mobile bake. */
export const BLUR_RANGE = { lowerBound: 0, upperBound: 100 } as const;
export const DEFAULT_BLUR = 50;

export function clampBlur(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_BLUR;
  }
  return Math.min(Math.max(Math.round(value), BLUR_RANGE.lowerBound), BLUR_RANGE.upperBound);
}

export const TRANSLUCENCY_RANGE = { lowerBound: 0.5, upperBound: 1 } as const;
export const DEFAULT_TRANSLUCENCY = 0.85;

export function clampTranslucency(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_TRANSLUCENCY;
  }
  return Math.min(Math.max(value, TRANSLUCENCY_RANGE.lowerBound), TRANSLUCENCY_RANGE.upperBound);
}

/**
 * Flat wash over the wallpaper. Dark mode pulls toward black, light mode
 * toward white — enough to keep primary/secondary text legible over a bright
 * sky. These are the current mac values (0.62/0.70).
 */
export function chatWashBase(colorScheme: "light" | "dark"): number {
  return colorScheme === "dark" ? 0.62 : 0.7;
}

/** Edge-tint gradient multipliers for the wallpaper (top / bottom). */
export const EDGE_WASH_TOP = 0.35;
export const EDGE_WASH_BOTTOM = 0.25;

/**
 * Alpha of a wash layer at translucency `t`. Scaling the wash with `t` is
 * what keeps the photo visible: a wash held near-constant keeps the pane
 * ~86% covered even at the glass end.
 */
export function washAlpha(base: number, translucency: number): number {
  return Math.min(base, 1) * clampTranslucency(translucency);
}

/**
 * Opacity for the photo under a wash of `washAlpha`, such that the two
 * together cover exactly `t`. Solves `wash + photo * (1 - wash) = t`.
 */
export function photoOpacity(translucency: number, wash: number): number {
  const t = clampTranslucency(translucency);
  if (wash >= 1) {
    return 0;
  }
  return Math.min(Math.max((t - wash) / (1 - wash), 0), 1);
}

/** What a photo + wash pair actually covers — `t` by construction. */
export function coverage(photo: number, wash: number): number {
  return wash + photo * (1 - wash);
}

/** The complete layer stack for a translucency, ready to hand to views. */
export interface SceneryLayerStack {
  readonly washAlpha: number;
  readonly photoOpacity: number;
  readonly edgeTopAlpha: number;
  readonly edgeBottomAlpha: number;
  /** Always equals the clamped translucency. */
  readonly coverage: number;
}

export function layerStack(translucency: number, colorScheme: "light" | "dark"): SceneryLayerStack {
  const t = clampTranslucency(translucency);
  const wash = washAlpha(chatWashBase(colorScheme), t);
  const photo = photoOpacity(t, wash);
  return {
    washAlpha: wash,
    photoOpacity: photo,
    edgeTopAlpha: EDGE_WASH_TOP * t,
    edgeBottomAlpha: EDGE_WASH_BOTTOM * t,
    coverage: coverage(photo, wash),
  };
}

/**
 * How many of the most recent assignments a random pick avoids repeating.
 * Capped at half the pool so extra themes (~100+ photos) still have
 * candidates; World Scenery (~950) keeps the full 120.
 */
const RECENT_EXCLUSION_WINDOW = 120;

/**
 * Thread routes come and go without a deletion signal reaching this store, so
 * assignments are LRU-capped instead of pruned by event. Old threads that
 * fall out re-resolve through the deterministic hash fallback.
 */
const MAX_ASSIGNMENTS = 300;

type SeedFile = { readonly photos: ReadonlyArray<SceneryPhoto> };

const EMPTY_SEED: ReadonlyArray<SceneryPhoto> = [];
const seedCache = new Map<PhotoSetId, ReadonlyArray<SceneryPhoto>>();
seedCache.set("world-scenery", (seedPoolJson as SeedFile).photos);

const seedLoaders: Record<PhotoSetId, () => Promise<unknown>> = {
  "world-scenery": () => Promise.resolve(seedPoolJson as SeedFile),
  "night-cities": () => import("./seeds/night-cities.json"),
  "deep-forest": () => import("./seeds/deep-forest.json"),
  "night-sky": () => import("./seeds/night-sky.json"),
  "grand-buildings": () => import("./seeds/grand-buildings.json"),
};

/** Metro/Vite JSON imports show up as `{photos}`, `{default:{photos}}`, or the array. */
export function photosFromSeedModule(mod: unknown): ReadonlyArray<SceneryPhoto> {
  if (Array.isArray(mod)) {
    return mod as ReadonlyArray<SceneryPhoto>;
  }
  if (mod !== null && typeof mod === "object") {
    const record = mod as { photos?: unknown; default?: unknown };
    if (Array.isArray(record.photos)) {
      return record.photos as ReadonlyArray<SceneryPhoto>;
    }
    if ("default" in record) {
      return photosFromSeedModule(record.default);
    }
  }
  return EMPTY_SEED;
}

export function peekSeedPhotos(photoSetId: PhotoSetId): ReadonlyArray<SceneryPhoto> {
  return seedCache.get(photoSetId) ?? EMPTY_SEED;
}

export async function loadSeedPhotos(photoSetId: PhotoSetId): Promise<ReadonlyArray<SceneryPhoto>> {
  const hit = seedCache.get(photoSetId);
  if (hit && hit.length > 0) {
    return hit;
  }
  const loaded = photosFromSeedModule(await seedLoaders[photoSetId]());
  if (loaded.length > 0) {
    seedCache.set(photoSetId, loaded);
  }
  return loaded;
}

/**
 * The photo pool: the bundled seed merged with photos fetched at runtime
 * (none on mobile yet — the parameter keeps the web shape and testability).
 */
export function getSceneryPool(
  fetchedPhotos: ReadonlyArray<SceneryPhoto>,
  seedPhotos: ReadonlyArray<SceneryPhoto> = peekSeedPhotos(DEFAULT_PHOTO_SET_ID),
): SceneryPhoto[] {
  const byId = new Map<string, SceneryPhoto>();
  for (const photo of seedPhotos) {
    byId.set(photo.id, photo);
  }
  for (const photo of fetchedPhotos) {
    byId.set(photo.id, photo);
  }
  return [...byId.values()];
}

export function sceneryPoolForSet(photoSetId: PhotoSetId): ReadonlyArray<SceneryPhoto> {
  return getSceneryPool([], peekSeedPhotos(photoSetId));
}

/** The World Scenery pool — the default set and the one golden tests pin. */
export const SCENERY_POOL: ReadonlyArray<SceneryPhoto> = sceneryPoolForSet(DEFAULT_PHOTO_SET_ID);

export function pickScenery(
  pool: ReadonlyArray<SceneryPhoto>,
  assignments: Record<string, SceneryAssignment>,
): SceneryPhoto | null {
  if (pool.length === 0) {
    return null;
  }
  const recent = Object.values(assignments)
    .sort((left, right) => right.assignedAt - left.assignedAt)
    .slice(0, Math.min(RECENT_EXCLUSION_WINDOW, Math.floor(pool.length / 2)));
  const occupied = new Set(recent.map((assignment) => assignment.photoId));
  const available = pool.filter((photo) => !occupied.has(photo.id));
  const candidates = available.length > 0 ? available : pool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

/**
 * Deterministic fallback when a thread has no live assignment (LRU-evicted,
 * or the assigned photo left the pool): the same FNV-1a bucket the desktop
 * theme uses. Not persisted — a pool-size change can re-bucket, which is
 * acceptable for threads old enough to have been evicted.
 */
export function fallbackPhoto(
  pool: ReadonlyArray<SceneryPhoto>,
  threadKey: string,
): SceneryPhoto | null {
  if (pool.length === 0) {
    return null;
  }
  return pool[stableIndex(threadKey, pool.length)] ?? null;
}

export function capAssignments(
  assignments: Record<string, SceneryAssignment>,
): Record<string, SceneryAssignment> {
  const entries = Object.entries(assignments);
  if (entries.length <= MAX_ASSIGNMENTS) {
    return assignments;
  }
  entries.sort((left, right) => right[1].assignedAt - left[1].assignedAt);
  return Object.fromEntries(entries.slice(0, MAX_ASSIGNMENTS));
}

/** Day key for the no-thread home rotation. */
export function dailySeed(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `daily|${year}-${month}-${day}`;
}

export function dailyFeatured(
  pool: ReadonlyArray<SceneryPhoto>,
  seed: string,
): SceneryPhoto | null {
  if (pool.length === 0) {
    return null;
  }
  return pool[stableIndex(seed, pool.length)] ?? null;
}

const SIZING_PARAMS = new Set(["w", "h", "q", "fm", "fit", "crop", "blur", "sat"]);

/**
 * Rewrites an Unsplash/imgix URL to a specific render width (and optional
 * pre-blur/saturation): replaces any existing sizing params, keeps identity
 * params (ixid) intact. `fit=max` never upscales past the original asset.
 * Pre-blur on the CDN replaces a runtime gaussian — deterministic and free
 * on-device.
 *
 * React Native's `URL` polyfill is partial, so this re-implements the web
 * port's `URL.searchParams` rewrite by hand. The outputs are pinned identical
 * to the web implementation by sceneryLogic.test.ts.
 */
export function sizedImageURL(
  url: string,
  options: { width: number; blur?: number; saturation?: number },
): string {
  const queryStart = url.indexOf("?");
  if (queryStart < 0) {
    return url;
  }
  const path = url.slice(0, queryStart);
  const kept: string[] = [];
  for (const pair of url.slice(queryStart + 1).split("&")) {
    const key = pair.slice(0, pair.indexOf("="));
    if (key.length > 0 && !SIZING_PARAMS.has(key)) {
      kept.push(pair);
    }
  }
  kept.push(`w=${options.width}`, "q=85", "fm=jpg", "fit=max");
  if (options.blur !== undefined && options.blur > 0) {
    kept.push(`blur=${options.blur}`);
  }
  if (options.saturation !== undefined && options.saturation !== 0) {
    kept.push(`sat=${options.saturation}`);
  }
  return `${path}?${kept.join("&")}`;
}

/**
 * Render width for the full-screen wallpaper: the screen's device-pixel
 * width, rounded up to a 256px step so the CDN cache stays warm across
 * near-identical sizes, capped at 3840 (the mac hero cap).
 */
export function wallpaperPixelWidth(rawPixelWidth: number): number {
  return Math.min(3840, Math.ceil(rawPixelWidth / 256) * 256);
}

/**
 * The pre-blurred wallpaper variant: SurgeCode mobile shipped `blur=50&sat=5`
 * baked on the CDN; the blur is user-adjustable (0–100) and 0 drops the param
 * for the sharp original.
 */
export function wallpaperURL(photo: SceneryPhoto, blur: number, width: number): string {
  const base = photo.rawURL ?? photo.heroURL;
  return sizedImageURL(base, { width, blur, saturation: 5 });
}
