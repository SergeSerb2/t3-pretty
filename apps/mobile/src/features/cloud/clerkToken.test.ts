import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@t3tools/client-runtime/relay", () => ({
  ManagedRelay: { MANAGED_RELAY_REQUEST_TIMEOUT_MS: 50 },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("mobile Connect session deadline", () => {
  it.each([
    ["public", "T3 Connect"],
    ["internal", "Surge Connect"],
  ])("uses %s service branding when a session lookup times out", async (flavor, name) => {
    vi.resetModules();
    vi.stubEnv("EXPO_PUBLIC_T3CODE_BUILD_FLAVOR", flavor);
    vi.useFakeTimers();
    const { readClerkTokenWithDeadline } = await import("./clerkToken");
    const result = readClerkTokenWithDeadline(() => new Promise(() => {})).catch(
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toEqual(new Error(`Timed out while reading the ${name} session token.`));
    expect(vi.getTimerCount()).toBe(0);
  });
});
