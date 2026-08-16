import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { isWallpaperReady, preloadWallpaper, resetWallpaperCache } from "./sceneryWallpaper";

afterEach(() => {
  resetWallpaperCache();
  vi.unstubAllGlobals();
});

describe("preloadWallpaper", () => {
  it("marks a url ready after decode and dedupes in-flight work", async () => {
    let constructed = 0;
    class FakeImage {
      decoding = "";
      complete = true;
      naturalWidth = 1280;
      src = "";
      decode = vi.fn(() => Promise.resolve());
      addEventListener = vi.fn();
      constructor() {
        constructed += 1;
      }
    }
    vi.stubGlobal("Image", FakeImage);

    const first = preloadWallpaper("https://images.example/a.jpg");
    const second = preloadWallpaper("https://images.example/a.jpg");
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(constructed).toBe(1);
    expect(isWallpaperReady("https://images.example/a.jpg")).toBe(true);

    await expect(preloadWallpaper("https://images.example/a.jpg")).resolves.toBe(true);
    expect(constructed).toBe(1);
  });

  it("does not cache a failed decode", async () => {
    class FakeImage {
      decoding = "";
      complete = false;
      naturalWidth = 0;
      src = "";
      decode = vi.fn(() => Promise.reject(new Error("decode failed")));
      addEventListener = vi.fn();
    }
    vi.stubGlobal("Image", FakeImage);

    await expect(preloadWallpaper("https://images.example/missing.jpg")).resolves.toBe(false);
    expect(isWallpaperReady("https://images.example/missing.jpg")).toBe(false);
  });
});
