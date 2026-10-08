import { describe, expect, it } from "vite-plus/test";

import { shouldHandleAppLink } from "./appLinking";

describe("shouldHandleAppLink", () => {
  it.each(["t3code://", "t3code:///", "t3code-dev://", "t3code-preview://"])(
    "ignores scheme-only URL %s",
    (url) => {
      expect(shouldHandleAppLink(url)).toBe(false);
    },
  );

  it.each([
    "t3code://threads/env-1/thread-1",
    "t3code://pair?pairingUrl=x",
    "t3code-dev://settings/usage?tab=limits",
  ])("handles path-bearing URL %s", (url) => {
    expect(shouldHandleAppLink(url)).toBe(true);
  });

  it.each([
    "t3code-dev://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081",
    "t3code://expo-development-client/?url=x",
    "t3code://expo-sharing",
    "t3code://expo-sharing/anything",
  ])("ignores the exact private lifecycle host: %s", (url) => {
    expect(shouldHandleAppLink(url)).toBe(false);
  });

  it.each([
    "t3code://threads/environment-1/expo-development-client",
    "t3code://threads/expo-development-client/thread-1",
    "t3code://expo-development-client-copy/",
    "t3code://expo-sharing-notification/",
  ])("keeps a real route that merely contains lifecycle text: %s", (url) => {
    expect(shouldHandleAppLink(url)).toBe(true);
  });
});
