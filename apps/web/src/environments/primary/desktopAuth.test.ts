import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";

import {
  __resetDesktopPrimaryAuthForTests,
  DESKTOP_BEARER_TOKEN_TIMEOUT_MS,
  readDesktopPrimaryBearerToken,
} from "./desktopAuth";

describe("desktop primary auth", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    __resetDesktopPrimaryAuthForTests();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("reuses the main-process bearer token across renderer requests", async () => {
    const getLocalEnvironmentBearerToken = vi.fn().mockResolvedValue("desktop-bearer-token");
    window.desktopBridge = {
      getLocalEnvironmentBearerToken,
    } as unknown as DesktopBridge;

    await expect(readDesktopPrimaryBearerToken()).resolves.toBe("desktop-bearer-token");
    await expect(readDesktopPrimaryBearerToken()).resolves.toBe("desktop-bearer-token");
    expect(getLocalEnvironmentBearerToken).toHaveBeenCalledTimes(1);
  });

  it("does not require desktop auth in a browser", async () => {
    await expect(readDesktopPrimaryBearerToken()).resolves.toBeNull();
  });

  it("clears a hung bearer IPC so splash auth can retry", async () => {
    vi.useFakeTimers();
    try {
      const getLocalEnvironmentBearerToken = vi.fn(() => new Promise<string>(() => undefined));
      window.desktopBridge = {
        getLocalEnvironmentBearerToken,
      } as unknown as DesktopBridge;

      const firstError = readDesktopPrimaryBearerToken().then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(DESKTOP_BEARER_TOKEN_TIMEOUT_MS);

      expect(await firstError).toBeInstanceOf(Error);
      getLocalEnvironmentBearerToken.mockResolvedValueOnce("desktop-bearer-token");
      await expect(readDesktopPrimaryBearerToken()).resolves.toBe("desktop-bearer-token");
      expect(getLocalEnvironmentBearerToken).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
