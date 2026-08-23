import { expect, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import {
  acceptsBrotliEncoding,
  assetResponseHeaders,
  isHashedClientAssetPath,
  isLoopbackHostname,
  resolveDevRedirectUrl,
  shouldEnablePermessageDeflate,
  staticClientAssetCacheControl,
  stripPermessageDeflateExtensionOffer,
} from "./http.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("does not treat LAN addresses as local", () => {
    expect(isLoopbackHostname("192.168.86.35")).toBe(false);
    expect(isLoopbackHostname("10.0.0.24")).toBe(false);
    expect(isLoopbackHostname("example.local")).toBe(false);
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});

describe("assetResponseHeaders", () => {
  it("sandboxes SVG assets", () => {
    expect(assetResponseHeaders("/attachments/user-image.svg")).toMatchObject({
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
    expect(assetResponseHeaders("/attachments/user-image.SVG")).toHaveProperty(
      "Content-Security-Policy",
    );
  });

  it("does not apply document policy to raster images", () => {
    expect(assetResponseHeaders("/attachments/user-image.png")).toEqual({
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("declares utf-8 for HTML assets so non-ASCII content renders correctly", () => {
    expect(assetResponseHeaders("/workspace/page.html")).toHaveProperty(
      "Content-Type",
      "text/html; charset=utf-8",
    );
    expect(assetResponseHeaders("/workspace/PAGE.HTM")).toHaveProperty(
      "Content-Type",
      "text/html; charset=utf-8",
    );
  });

  it("caches attachment bytes immutably and allows cross-origin reads", () => {
    expect(assetResponseHeaders("/attachments/user-image.png", "attachment")).toEqual({
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    });
  });

  it("keeps workspace-file caching but allows cross-origin reads", () => {
    expect(assetResponseHeaders("/workspace/report.png", "workspace-file")).toEqual({
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    });
  });

  it("allows cross-origin reads for generated images outside the workspace", () => {
    expect(assetResponseHeaders("/tmp/generated.jpg", "generated-image")).toEqual({
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    });
  });

  it("does not open project favicons to cross-origin reads", () => {
    expect(assetResponseHeaders("/workspace/favicon.png", "project-favicon")).toEqual({
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
  });
});

describe("static client asset cache", () => {
  it("treats hashed Vite assets as immutable", () => {
    expect(isHashedClientAssetPath("assets/index-C2xY3z4A.js")).toBe(true);
    expect(staticClientAssetCacheControl("assets/index-C2xY3z4A.js")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("does not cache HTML or unhashed files as immutable", () => {
    expect(isHashedClientAssetPath("index.html")).toBe(false);
    expect(staticClientAssetCacheControl("index.html")).toBe("no-cache");
    expect(isHashedClientAssetPath("assets/README.md")).toBe(false);
  });

  it("detects brotli in Accept-Encoding", () => {
    expect(acceptsBrotliEncoding("gzip, deflate, br")).toBe(true);
    expect(acceptsBrotliEncoding("br;q=1.0, gzip;q=0.8")).toBe(true);
    expect(acceptsBrotliEncoding("gzip, deflate")).toBe(false);
    expect(acceptsBrotliEncoding(undefined)).toBe(false);
  });
});

describe("permessage-deflate negotiation", () => {
  it("disables compression for the desktop renderer and loopback peers", () => {
    expect(
      shouldEnablePermessageDeflate({
        remoteAddress: "127.0.0.1",
        origin: "t3code://app",
      }),
    ).toBe(false);
    expect(
      shouldEnablePermessageDeflate({
        remoteAddress: "127.0.0.1",
        origin: "http://127.0.0.1:3773",
      }),
    ).toBe(false);
  });

  it("keeps compression for LAN and tunneled browser origins", () => {
    expect(
      shouldEnablePermessageDeflate({
        remoteAddress: "192.168.1.20",
        origin: "http://192.168.1.4:3773",
      }),
    ).toBe(true);
    expect(
      shouldEnablePermessageDeflate({
        remoteAddress: "127.0.0.1",
        origin: "https://example.trycloudflare.com",
      }),
    ).toBe(true);
  });

  it("strips only the permessage-deflate offer from the extensions header", () => {
    expect(
      stripPermessageDeflateExtensionOffer(
        "permessage-deflate; client_max_window_bits, x-webkit-deflate-frame",
      ),
    ).toBe("x-webkit-deflate-frame");
    expect(stripPermessageDeflateExtensionOffer("permessage-deflate")).toBeUndefined();
  });
});
