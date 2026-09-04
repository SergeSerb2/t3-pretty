import { describe, expect, it } from "vite-plus/test";

import {
  isSecureRelayUrl,
  normalizeSecureRelayUrl,
  SECURE_RELAY_URL_MAX_LENGTH,
} from "./relayUrl.ts";

describe("normalizeSecureRelayUrl", () => {
  it("normalizes secure relay origins", () => {
    expect(normalizeSecureRelayUrl(" https://relay.example.test/// ")).toBe(
      "https://relay.example.test",
    );
    expect(normalizeSecureRelayUrl("https://relay.example.test:8443/")).toBe(
      "https://relay.example.test:8443",
    );
  });

  it.each([
    "http://relay.example.test",
    "https://user:password@relay.example.test",
    "https://relay.example.test/path",
    "https://relay.example.test?query=value",
    "https://relay.example.test#fragment",
    "not a url",
  ])("rejects unsafe relay URL %s", (value) => {
    expect(normalizeSecureRelayUrl(value)).toBeNull();
    expect(isSecureRelayUrl(value)).toBe(false);
  });

  it("rejects oversized relay URLs before parsing them", () => {
    expect(
      normalizeSecureRelayUrl(
        `https://relay.example.test/${"a".repeat(SECURE_RELAY_URL_MAX_LENGTH)}`,
      ),
    ).toBeNull();
  });
});
