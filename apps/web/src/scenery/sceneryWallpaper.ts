/**
 * Decode cache for World Scenery wallpapers. Arrival and thread swaps share
 * this so a photo primed before navigation is already in the HTTP cache and
 * decoded before SceneryLayer commits it. decode() is what removes the
 * main-thread hitch of painting a 1280px JPEG the first time.
 */

const MAX_READY = 8;
const WALLPAPER_DECODE_TIMEOUT_MS = 15_000;

const ready = new Set<string>();
const inflight = new Map<string, Promise<boolean>>();

export function isWallpaperReady(url: string): boolean {
  return ready.has(url);
}

export function preloadWallpaper(url: string): Promise<boolean> {
  if (!url) {
    return Promise.resolve(false);
  }
  if (ready.has(url)) {
    return Promise.resolve(true);
  }
  const existing = inflight.get(url);
  if (existing) {
    return existing;
  }
  const promise = decodeWallpaper(url).then((ok) => {
    inflight.delete(url);
    if (ok) {
      rememberReady(url);
    }
    return ok;
  });
  inflight.set(url, promise);
  return promise;
}

/** Test hook. Production code never clears a decoded url. */
export function resetWallpaperCache(): void {
  ready.clear();
  inflight.clear();
}

function rememberReady(url: string): void {
  ready.delete(url);
  ready.add(url);
  if (ready.size <= MAX_READY) {
    return;
  }
  const oldest = ready.values().next().value;
  if (oldest !== undefined) {
    ready.delete(oldest);
  }
}

function decodeWallpaper(url: string): Promise<boolean> {
  if (typeof Image === "undefined") {
    return Promise.resolve(false);
  }
  const image = new Image();
  image.decoding = "async";
  return new Promise((resolve) => {
    let settled = false;
    const onError = () => finish(false);
    const onLoad = () => finish(true);
    const timeoutId = setTimeout(() => {
      finish(false);
      image.src = "";
    }, WALLPAPER_DECODE_TIMEOUT_MS);
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      image.removeEventListener("error", onError);
      image.removeEventListener("load", onLoad);
      resolve(ok);
    };
    image.addEventListener("error", onError, { once: true });
    if (typeof image.decode === "function") {
      image.src = url;
      void image.decode().then(
        () => finish(true),
        () => finish(image.complete && image.naturalWidth > 0),
      );
      return;
    }
    image.addEventListener("load", onLoad, { once: true });
    image.src = url;
  });
}
