import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { decodeRelease, fetchLatestRelease, fetchLatestNightlyRelease } from "./releases.ts";

const release = {
  tag_name: "v1.2.3",
  html_url: "https://github.com/SergeSerb2/t3-pretty/releases/tag/v1.2.3",
  published_at: "2026-09-08T00:00:00Z",
  assets: [
    {
      name: "T3-Code.dmg",
      browser_download_url:
        "https://github.com/SergeSerb2/t3-pretty/releases/download/v1.2.3/T3-Code.dmg",
    },
  ],
};

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => values.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeRelease", () => {
  it("accepts canonical GitHub release URLs", () => {
    expect(decodeRelease(release)).toEqual(release);
  });

  it("rejects executable and off-origin asset URLs", () => {
    expect(
      decodeRelease({
        ...release,
        assets: [{ name: "T3-Code.dmg", browser_download_url: "javascript:alert(1)" }],
      }),
    ).toBeNull();
    expect(
      decodeRelease({
        ...release,
        assets: [{ name: "T3-Code.dmg", browser_download_url: "https://example.com/app.dmg" }],
      }),
    ).toBeNull();
  });
});

describe("fetchLatestRelease", () => {
  it("refreshes a corrupt cache and stores a timestamped validated release", async () => {
    const store = memoryStorage({ "t3code-latest-release": "not json" });
    vi.stubGlobal("sessionStorage", store);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(release)),
    );

    await expect(fetchLatestRelease()).resolves.toEqual(release);
    const cached = JSON.parse(store.getItem("t3code-latest-release") ?? "");
    expect(cached).toMatchObject({ release });
    expect(cached.release.html_url).toContain("SergeSerb2/t3-pretty");
  });

  it("rejects unsuccessful and oversized responses when no stale release exists", async () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    await expect(fetchLatestRelease()).rejects.toThrow("failed (429)");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: { "content-length": String(1024 * 1024 + 1) },
          }),
      ),
    );
    await expect(fetchLatestRelease()).rejects.toThrow("too large");
  });

  it("cancels a declared oversized response without draining it", async () => {
    let cancelled = false;
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              cancel: () => {
                cancelled = true;
              },
            }),
            { headers: { "content-length": String(1024 * 1024 + 1) } },
          ),
      ),
    );

    await expect(fetchLatestRelease()).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
  });

  it("sorts by published_at desc after filtering, older in API order loses", async () => {
    const olderNightly = {
      tag_name: "v0.0.38-nightly.20260906.1000",
      html_url:
        "https://github.com/SergeSerb2/t3-pretty/releases/tag/v0.0.38-nightly.20260906.1000",
      draft: false,
      published_at: "2026-09-06T10:00:00Z",
      assets: [],
    };
    const newestNightly = {
      tag_name: "v0.0.39-nightly.20260907.1332",
      html_url:
        "https://github.com/SergeSerb2/t3-pretty/releases/tag/v0.0.39-nightly.20260907.1332",
      draft: false,
      published_at: "2026-09-07T13:32:00Z",
      assets: [
        {
          name: "T3-Code-nightly.dmg",
          browser_download_url:
            "https://github.com/SergeSerb2/t3-pretty/releases/download/v0.0.39-nightly.20260907.1332/T3-Code-nightly.dmg",
        },
      ],
    };
    const draftNightly = {
      tag_name: "v0.0.40-nightly.20260908.1000",
      html_url:
        "https://github.com/SergeSerb2/t3-pretty/releases/tag/v0.0.40-nightly.20260908.1000",
      draft: true,
      published_at: "2026-09-08T10:00:00Z",
      assets: [],
    };
    const stableRelease = {
      tag_name: "v1.0.0",
      html_url: "https://github.com/SergeSerb2/t3-pretty/releases/tag/v1.0.0",
      draft: false,
      published_at: "2026-09-09T00:00:00Z",
      assets: [],
    };

    const store = memoryStorage();
    vi.stubGlobal("sessionStorage", store);
    vi.stubGlobal(
      "fetch",
      // CRITICAL: olderNightly appears FIRST in API order but has older published_at
      // Must sort by published_at desc, so newestNightly wins despite appearing later
      vi.fn(async () => Response.json([olderNightly, stableRelease, newestNightly, draftNightly])),
    );

    const result = await fetchLatestNightlyRelease();
    expect(result).toEqual(newestNightly);
    expect(result.tag_name).toBe("v0.0.39-nightly.20260907.1332");

    const cached = JSON.parse(store.getItem("t3code-latest-nightly") ?? "");
    expect(cached).toMatchObject({ release: newestNightly });
    expect(cached.release.html_url).toContain("SergeSerb2/t3-pretty");
  });

  it("sorts legacy nightlies by published_at desc, older API order loses", async () => {
    const olderLegacy = {
      tag_name: "nightly-v0.8.5",
      html_url: "https://github.com/SergeSerb2/t3-pretty/releases/tag/nightly-v0.8.5",
      draft: false,
      published_at: "2026-08-05T10:00:00Z",
      assets: [],
    };
    const newerLegacy = {
      tag_name: "nightly-v0.9.0",
      html_url: "https://github.com/SergeSerb2/t3-pretty/releases/tag/nightly-v0.9.0",
      draft: false,
      published_at: "2026-09-01T10:00:00Z",
      assets: [],
    };

    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal(
      "fetch",
      // CRITICAL: newer legacy appears LAST in API order but has newer published_at
      vi.fn(async () => Response.json([newerLegacy, olderLegacy])),
    );

    const result = await fetchLatestNightlyRelease();
    expect(result).toEqual(newerLegacy);
    expect(result.tag_name).toBe("nightly-v0.9.0");
  });
});
