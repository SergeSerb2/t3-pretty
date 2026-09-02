import { describe, expect, it } from "@effect/vitest";

import { parseNativeShowcasePairingUrls } from "./nativeShowcaseScene";

describe("parseNativeShowcasePairingUrls", () => {
  it("reads legacy single URLs and URI-encoded JSON arrays", () => {
    expect(parseNativeShowcasePairingUrls(" https://one.example.test/pair ")).toEqual([
      "https://one.example.test/pair",
    ]);

    const encoded = encodeURIComponent(
      JSON.stringify(["https://one.example.test/pair", "https://two.example.test/pair"]),
    );
    expect(parseNativeShowcasePairingUrls(`json-uri:${encoded}`)).toEqual([
      "https://one.example.test/pair",
      "https://two.example.test/pair",
    ]);
  });

  it("bounds URL count and individual URL length before retaining launch input", () => {
    const urls = Array.from({ length: 24 }, (_, index) => `https://${index}.example.test/pair`);

    expect(parseNativeShowcasePairingUrls(JSON.stringify(urls))).toHaveLength(16);
    expect(parseNativeShowcasePairingUrls(`https://example.test/${"x".repeat(8_192)}`)).toEqual([]);
  });

  it("rejects malformed encoded input", () => {
    expect(parseNativeShowcasePairingUrls("json-uri:%E0%A4%A")).toEqual([]);
  });
});
