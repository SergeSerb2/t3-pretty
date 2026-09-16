import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DESKTOP_WSL_DISTRO_NAME_MAX_LENGTH,
  DesktopEnvironmentBootstrapSchema,
  DesktopSshEnvironmentTargetSchema,
  DesktopSshPasswordPromptResolutionInputSchema,
  DesktopWslDistroNameSchema,
} from "./ipc.ts";

describe("DesktopEnvironmentBootstrapSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopEnvironmentBootstrapSchema);

  it("preserves the concrete running distro separately from the backend id", () => {
    expect(
      decode({
        id: "wsl:default",
        label: "WSL (Ubuntu)",
        runningDistro: "Ubuntu",
        httpBaseUrl: "http://127.0.0.1:3774/",
        wsBaseUrl: "ws://127.0.0.1:3774/",
      }),
    ).toEqual({
      id: "wsl:default",
      label: "WSL (Ubuntu)",
      runningDistro: "Ubuntu",
      httpBaseUrl: "http://127.0.0.1:3774/",
      wsBaseUrl: "ws://127.0.0.1:3774/",
    });
  });

  it("allows non-running and non-WSL bootstraps to report no running distro", () => {
    expect(
      decode({
        id: "primary",
        label: "Windows",
        runningDistro: null,
        httpBaseUrl: null,
        wsBaseUrl: null,
      }).runningDistro,
    ).toBeNull();
  });
});

describe("DesktopWslDistroNameSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopWslDistroNameSchema);

  it("preserves distro names independently of SSH alias semantics", () => {
    expect(decode("Ubuntu 22.04 (LTS)")).toBe("Ubuntu 22.04 (LTS)");
    expect(() => decode("x".repeat(DESKTOP_WSL_DISTRO_NAME_MAX_LENGTH + 1))).toThrow();
  });
});

describe("desktop SSH IPC schemas", () => {
  const decodeTarget = Schema.decodeUnknownSync(DesktopSshEnvironmentTargetSchema);
  const decodePromptResolution = Schema.decodeUnknownSync(
    DesktopSshPasswordPromptResolutionInputSchema,
  );

  it("accepts a normal SSH target and rejects invalid ports", () => {
    expect(
      decodeTarget({ alias: "devbox", hostname: "devbox.local", username: "serge", port: 22 }),
    ).toEqual({ alias: "devbox", hostname: "devbox.local", username: "serge", port: 22 });
    expect(() =>
      decodeTarget({ alias: "devbox", hostname: "devbox.local", username: null, port: 0 }),
    ).toThrow();
  });

  it("rejects oversized renderer-provided prompt credentials", () => {
    expect(() =>
      decodePromptResolution({ requestId: "request", password: "x".repeat(64 * 1024 + 1) }),
    ).toThrow();
    expect(() => decodePromptResolution({ requestId: "x".repeat(129), password: null })).toThrow();
  });
});
