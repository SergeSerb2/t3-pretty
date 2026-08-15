import { describe, expect, it } from "vite-plus/test";

import { alignQueryableAssetUrls, isQueryableAssetResource, resolveAssetUrl } from "./assetUrls";

describe("resolveAssetUrl", () => {
  it("resolves an environment-relative asset URL", () => {
    expect(
      resolveAssetUrl("https://environment.example/base/", "/api/assets/signed-token/favicon.png"),
    ).toBe("https://environment.example/api/assets/signed-token/favicon.png");
  });

  it("rejects an invalid environment base URL", () => {
    expect(resolveAssetUrl("not a URL", "/api/assets/signed-token/favicon.png")).toBeNull();
  });
});

describe("queryable asset resources", () => {
  it("rejects the canvas pending-image attachment sentinel", () => {
    expect(isQueryableAssetResource({ _tag: "attachment", attachmentId: "" })).toBe(false);
    expect(isQueryableAssetResource({ _tag: "attachment", attachmentId: "   " })).toBe(false);
    expect(isQueryableAssetResource({ _tag: "attachment", attachmentId: "att-1" })).toBe(true);
  });

  it("aligns queryable results onto the original resource list", () => {
    const resources = [
      { _tag: "attachment" as const, attachmentId: "" },
      { _tag: "attachment" as const, attachmentId: "att-1" },
      { _tag: "attachment" as const, attachmentId: "att-2" },
    ];
    expect(alignQueryableAssetUrls(resources, ["url-1", "url-2"])).toEqual([
      null,
      "url-1",
      "url-2",
    ]);
  });
});
