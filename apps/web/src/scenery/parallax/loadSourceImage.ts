import { PARALLAX_PROCESS_WIDTH, type PixelBuffer } from "./types";

export function loadCorsImage(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") {
    return Promise.resolve(null);
  }
  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";
  return new Promise((resolve) => {
    const fail = () => resolve(null);
    image.addEventListener("error", fail, { once: true });
    const finish = () => {
      if (image.naturalWidth > 0) {
        resolve(image);
        return;
      }
      resolve(null);
    };
    if (typeof image.decode === "function") {
      image.src = url;
      void image.decode().then(finish, fail);
      return;
    }
    image.addEventListener("load", finish, { once: true });
    image.src = url;
  });
}

export function rasterizeImage(
  image: CanvasImageSource & { readonly naturalWidth?: number; readonly naturalHeight?: number },
  maxWidth = PARALLAX_PROCESS_WIDTH,
): PixelBuffer | null {
  const naturalWidth =
    "naturalWidth" in image && image.naturalWidth
      ? image.naturalWidth
      : (image as HTMLImageElement).width;
  const naturalHeight =
    "naturalHeight" in image && image.naturalHeight
      ? image.naturalHeight
      : (image as HTMLImageElement).height;
  if (!naturalWidth || !naturalHeight) {
    return null;
  }
  const scale = Math.min(1, maxWidth / naturalWidth);
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }
  try {
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    return { data: pixels.data, width, height };
  } catch {
    // Tainted canvas (CORS). The renderer falls back to a single tilted card.
    return null;
  }
}
