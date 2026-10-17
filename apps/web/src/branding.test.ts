import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { T3CODE_BUILD_FLAVOR } from "@t3tools/shared/connectBranding";
import {
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
} from "./branding.logic";

const originalWindow = globalThis.window;
const expectedBaseName = T3CODE_BUILD_FLAVOR === "internal" ? "T3 Pretty Internal" : "T3 Pretty";

afterEach(() => {
  vi.doUnmock("@t3tools/shared/connectBranding");
  vi.unstubAllEnvs();
  vi.resetModules();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it.each([
    {
      flavor: "public",
      dev: false,
      version: "1.0.0",
      channel: "",
      stage: "Latest",
      name: "T3 Pretty",
    },
    {
      flavor: "public",
      dev: false,
      version: "0.0.45",
      channel: "",
      stage: "Latest",
      name: "T3 Pretty",
    },
    {
      flavor: "public",
      dev: true,
      version: "1.0.0",
      channel: "",
      stage: "Dev",
      name: "T3 Pretty (Dev)",
    },
    {
      flavor: "public",
      dev: false,
      version: "1.0.0-preview.20261016.1",
      channel: "",
      stage: "Beta",
      name: "T3 Pretty (Beta)",
    },
    {
      flavor: "public",
      dev: false,
      version: "1.0.0-beta.1",
      channel: "",
      stage: "Beta",
      name: "T3 Pretty (Beta)",
    },
    {
      flavor: "internal",
      dev: false,
      version: "1.0.0",
      channel: "",
      stage: "Beta",
      name: "T3 Pretty Internal (Beta)",
    },
    {
      flavor: "internal",
      dev: true,
      version: "1.0.0",
      channel: "",
      stage: "Dev",
      name: "T3 Pretty Internal (Dev)",
    },
    {
      flavor: "public",
      dev: false,
      version: "1.0.0",
      channel: "nightly",
      stage: "Nightly",
      name: "T3 Pretty (Nightly)",
    },
    {
      flavor: "public",
      dev: false,
      version: "1.0.0-preview.20261016.1",
      channel: "latest",
      stage: "Latest",
      name: "T3 Pretty",
    },
  ] as const)("brands $flavor $version development=$dev channel=$channel", async (input) => {
    vi.doMock("@t3tools/shared/connectBranding", () => ({ T3CODE_BUILD_FLAVOR: input.flavor }));
    vi.stubEnv("DEV", input.dev);
    vi.stubEnv("APP_VERSION", input.version);
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", input.channel);
    const branding = await import("./branding");
    expect(branding.APP_STAGE_LABEL).toBe(input.stage);
    expect(branding.APP_DISPLAY_NAME).toBe(input.name);
  });

  it("uses injected desktop branding when available", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "T3 Pretty",
            stageLabel: "Nightly",
            displayName: "T3 Pretty (Nightly)",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("T3 Pretty");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Pretty (Nightly)");
  });

  it("normalizes hosted app channel metadata", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("nightly");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Nightly");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe(`${expectedBaseName} (Nightly)`);
  });

  it("does not label the latest hosted app channel", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "latest");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("latest");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Latest");
    expect(branding.APP_STAGE_LABEL).toBe("Latest");
    expect(branding.APP_DISPLAY_NAME).toBe(expectedBaseName);
  });

  it("ignores unknown hosted app channels", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "preview");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBeNull();
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBeNull();
  });
});

describe("branding logic", () => {
  it.each([
    { serverVersion: "1.0.0", name: "T3 Pretty" },
    { serverVersion: "1.0.0-nightly.20261016.1", name: "T3 Pretty (Nightly)" },
    { serverVersion: "1.0.0-preview.20261016.1", name: "T3 Pretty (Nightly)" },
  ])(
    "keeps the server title rule for a stable client connected to $serverVersion",
    ({ serverVersion, name }) => {
      expect(
        resolveServerBackedAppDisplayName({
          baseName: "T3 Pretty",
          fallbackDisplayName: "T3 Pretty",
          fallbackStageLabel: "Latest",
          primaryServerVersion: serverVersion,
        }),
      ).toBe(name);
    },
  );

  it("returns Nightly for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Nightly");
  });

  it("updates the display name for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Pretty",
        fallbackDisplayName: "T3 Pretty (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616.12",
      }),
    ).toBe("T3 Pretty (Nightly)");
  });

  it("keeps the fallback display name for stable primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Pretty",
        fallbackDisplayName: "T3 Pretty (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.27",
      }),
    ).toBe("T3 Pretty (Alpha)");
  });

  it("keeps the fallback display name for malformed nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Pretty",
        fallbackDisplayName: "T3 Pretty (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616",
      }),
    ).toBe("T3 Pretty (Alpha)");
  });
});
