import { describe, expect, it } from "vite-plus/test";

import {
  getProjectFaviconCacheKey,
  isManagedProjectFaviconPath,
  isProjectFaviconFallbackUrl,
  managedProjectFaviconFileName,
  PROJECT_FAVICON_FALLBACK_MARKER,
  toManagedProjectFaviconPath,
} from "./projectFavicon.ts";

describe("project favicon", () => {
  it("uses the project and versioned filename as the cache identity", () => {
    const firstUrl = "https://environment.example/api/assets/first-signed-token/v1-20-favicon.svg";
    const refreshedUrl =
      "https://environment.example/api/assets/refreshed-signed-token/v1-20-favicon.svg";

    expect(getProjectFaviconCacheKey("environment-1", "/workspace", firstUrl)).toBe(
      getProjectFaviconCacheKey("environment-1", "/workspace", refreshedUrl),
    );
    expect(getProjectFaviconCacheKey("environment-1", "/workspace", firstUrl)).not.toBe(
      getProjectFaviconCacheKey(
        "environment-1",
        "/workspace",
        "https://environment.example/api/assets/refreshed-signed-token/v2-20-favicon.svg",
      ),
    );
    expect(getProjectFaviconCacheKey("environment-1", "/workspace", firstUrl)).not.toBe(
      getProjectFaviconCacheKey("environment-2", "/workspace", firstUrl),
    );
  });

  it("identifies fallback asset URLs by their dedicated filename", () => {
    expect(
      isProjectFaviconFallbackUrl(
        `https://environment.example/api/assets/signed-token/${PROJECT_FAVICON_FALLBACK_MARKER}`,
      ),
    ).toBe(true);
    expect(
      isProjectFaviconFallbackUrl(`/api/assets/signed-token/${PROJECT_FAVICON_FALLBACK_MARKER}`),
    ).toBe(true);
  });

  it("does not mistake real favicons or query parameters for fallbacks", () => {
    expect(
      isProjectFaviconFallbackUrl("https://environment.example/api/assets/token/favicon.svg"),
    ).toBe(false);
    expect(
      isProjectFaviconFallbackUrl(
        `https://environment.example/api/assets/token/favicon.svg?name=${PROJECT_FAVICON_FALLBACK_MARKER}`,
      ),
    ).toBe(false);
    expect(isProjectFaviconFallbackUrl(null)).toBe(false);
  });

  it("turns a picked file name into a managed project icon path", () => {
    expect(toManagedProjectFaviconPath("/Users/ada/Pictures/Logo.PNG")).toBe(
      "t3-project-icon/Logo.png",
    );
    expect(toManagedProjectFaviconPath("brand/icon.svg")).toBe("t3-project-icon/icon.svg");
    expect(toManagedProjectFaviconPath("../secrets.env")).toBeNull();
    expect(toManagedProjectFaviconPath("notes.md")).toBeNull();
    expect(isManagedProjectFaviconPath("t3-project-icon/Logo.png")).toBe(true);
    expect(isManagedProjectFaviconPath("brand/icon.svg")).toBe(false);
    expect(managedProjectFaviconFileName("t3-project-icon/Logo.png")).toBe("Logo.png");
  });
});
