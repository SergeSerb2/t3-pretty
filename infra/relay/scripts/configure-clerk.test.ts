import { describe, expect, it, vi } from "vite-plus/test";

import {
  DESKTOP_CLERK_ALLOWED_ORIGINS,
  mergeClerkAllowedOrigins,
  reconcileClerkAllowedOrigins,
  resolveClerkSecretKey,
  type ClerkInstanceClient,
} from "./configure-clerk.ts";

describe("resolveClerkSecretKey", () => {
  it("accepts a bounded key and rejects controls or oversized values", () => {
    expect(resolveClerkSecretKey("  sk_live_example  ")).toBe("sk_live_example");
    expect(resolveClerkSecretKey("sk_live_example\nforged")).toBeUndefined();
    expect(resolveClerkSecretKey("x".repeat(8193))).toBeUndefined();
  });
});

describe("mergeClerkAllowedOrigins", () => {
  it("adds both desktop renderer origins without replacing existing origins", () => {
    expect(mergeClerkAllowedOrigins(["https://surgecode.com", "t3code://app"])).toEqual([
      "https://surgecode.com",
      ...DESKTOP_CLERK_ALLOWED_ORIGINS,
    ]);
  });

  it("starts from the required desktop origins when Clerk has no allowlist", () => {
    expect(mergeClerkAllowedOrigins(null)).toEqual(DESKTOP_CLERK_ALLOWED_ORIGINS);
  });
});

describe("reconcileClerkAllowedOrigins", () => {
  it("updates Clerk only when a desktop origin is missing", async () => {
    const update = vi.fn(async () => undefined);
    const client: ClerkInstanceClient = {
      instance: {
        get: vi.fn(async () => ({ allowedOrigins: ["https://surgecode.com"] })),
        update,
      },
    };

    await expect(reconcileClerkAllowedOrigins(client)).resolves.toEqual({
      changed: true,
      allowedOrigins: ["https://surgecode.com", ...DESKTOP_CLERK_ALLOWED_ORIGINS],
    });
    expect(update).toHaveBeenCalledWith({
      allowedOrigins: ["https://surgecode.com", ...DESKTOP_CLERK_ALLOWED_ORIGINS],
    });
  });

  it("is a no-op after the required origins are present", async () => {
    const update = vi.fn(async () => undefined);
    const client: ClerkInstanceClient = {
      instance: {
        get: vi.fn(async () => ({
          allowedOrigins: ["https://surgecode.com", ...DESKTOP_CLERK_ALLOWED_ORIGINS],
        })),
        update,
      },
    };

    await expect(reconcileClerkAllowedOrigins(client)).resolves.toEqual({
      changed: false,
      allowedOrigins: ["https://surgecode.com", ...DESKTOP_CLERK_ALLOWED_ORIGINS],
    });
    expect(update).not.toHaveBeenCalled();
  });
});
