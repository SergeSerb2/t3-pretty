import { describe, expect, it, vi } from "vite-plus/test";

import {
  makeUnsplashClient,
  sanitizeSceneryPhoto,
  sizedImageURL,
  trustedUnsplashDownloadUrl,
  unsplashProfileAttributionUrl,
  UNSPLASH_SEARCH_MAX_COUNT,
} from "./unsplash";

const photo = {
  id: "photo-1",
  color: "#123abc",
  urls: {
    raw: "https://images.unsplash.com/photo-1",
    regular: "https://images.unsplash.com/photo-1?w=1080",
    thumb: "https://images.unsplash.com/photo-1?w=200",
  },
  links: {
    download_location: "https://api.unsplash.com/photos/photo-1/download?ixid=abc",
  },
  user: {
    name: "Photographer",
    links: { html: "https://unsplash.com/@photographer" },
  },
};

describe("Unsplash client bounds", () => {
  it("never sends credentials to an untrusted download registration URL", async () => {
    const fetchMock = vi.fn();
    const client = makeUnsplashClient("valid_key", fetchMock);

    await expect(client?.registerDownload("https://example.com/collect")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      trustedUnsplashDownloadUrl("https://api.unsplash.com/photos/photo-1/download?ixid=abc"),
    ).not.toBeNull();
    expect(unsplashProfileAttributionUrl("javascript:alert(1)")).toBeNull();
  });

  it("caps result count and filters malformed photo URLs", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({
        results: [photo, { ...photo, id: "bad", urls: { ...photo.urls, raw: "javascript:x" } }],
      }),
    );
    const client = makeUnsplashClient("valid_key", fetchMock);

    await expect(client?.searchPhotos("mountains", 10_000)).resolves.toEqual([
      expect.objectContaining({ id: "photo-1" }),
    ]);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("per_page")).toBe(String(UNSPLASH_SEARCH_MAX_COUNT));
  });

  it("refuses executable image URLs and clamps CDN transforms", () => {
    expect(sizedImageURL("javascript:alert(1)", { width: 100 })).toBe("");
    const url = new URL(
      sizedImageURL("https://images.unsplash.com/photo-1", {
        width: Number.POSITIVE_INFINITY,
        blur: 500,
        saturation: -500,
      }),
    );
    expect(url.searchParams.get("w")).toBe("1280");
    expect(url.searchParams.get("blur")).toBe("100");
    expect(url.searchParams.get("sat")).toBe("-100");
    expect(
      sanitizeSceneryPhoto({
        id: "photo",
        name: "Place",
        averageColorHex: null,
        heroURL: "javascript:alert(1)",
        thumbURL: "https://images.unsplash.com/thumb",
        rawURL: null,
        downloadLocationURL: null,
        photographerName: "Photographer",
        photographerProfileURL: null,
      }),
    ).toBeNull();
  });
});
