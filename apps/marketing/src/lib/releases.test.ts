import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { decodeRelease, fetchLatestRelease } from "./releases.ts";

const release = {
  tag_name: "v1.2.3",
  html_url: "https://github.com/pingdotgg/t3code/releases/tag/v1.2.3",
  assets: [
    {
      name: "T3-Code.dmg",
      browser_download_url:
        "https://github.com/pingdotgg/t3code/releases/download/v1.2.3/T3-Code.dmg",
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
    expect(JSON.parse(store.getItem("t3code-latest-release") ?? "")).toMatchObject({ release });
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
});
