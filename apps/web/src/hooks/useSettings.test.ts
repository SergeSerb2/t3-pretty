import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import {
  mergeEnvironmentSettings,
  resolveEnvironmentIdentificationMode,
  resolveEnvironmentIdentificationSetting,
} from "./useSettings";

describe("resolveEnvironmentIdentificationMode", () => {
  it("keeps identification hidden until client settings hydrate", () => {
    expect(resolveEnvironmentIdentificationMode({ mode: "artwork", settingsHydrated: false })).toBe(
      "none",
    );
    expect(resolveEnvironmentIdentificationMode({ mode: "pill", settingsHydrated: true })).toBe(
      "pill",
    );
  });

  it("uses a pill instead of artwork with a palette theme", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        settingsHydrated: true,
        paletteThemeActive: true,
      }),
    ).toBe("pill");
  });

  it("respects none with a palette theme", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "none",
        settingsHydrated: true,
        paletteThemeActive: true,
      }),
    ).toBe("none");
  });

  it("keeps artwork when the palette theme opts into it", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        settingsHydrated: true,
        paletteThemeActive: true,
        paletteThemeAllowsArtwork: true,
      }),
    ).toBe("artwork");
  });

  it("falls back to artwork when a stored or remapped pill has no label", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "pill",
        settingsHydrated: true,
        pillAvailable: false,
      }),
    ).toBe("artwork");
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        settingsHydrated: true,
        paletteThemeActive: true,
        pillAvailable: false,
      }),
    ).toBe("artwork");
  });

  it("keeps none when the version pill is unavailable", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "none",
        settingsHydrated: true,
        paletteThemeActive: true,
        pillAvailable: false,
      }),
    ).toBe("none");
  });
});

describe("resolveEnvironmentIdentificationSetting", () => {
  it("offers the version pill when the stage has a pill label", () => {
    expect(resolveEnvironmentIdentificationSetting({ mode: "pill", pillAvailable: true })).toEqual({
      modes: ["artwork", "pill", "none"],
      value: "pill",
    });
  });

  it("hides the version pill and treats a stored pill as artwork when none exists", () => {
    expect(resolveEnvironmentIdentificationSetting({ mode: "pill", pillAvailable: false })).toEqual(
      {
        modes: ["artwork", "none"],
        value: "artwork",
      },
    );
  });

  it("keeps artwork and none when the version pill is unavailable", () => {
    expect(
      resolveEnvironmentIdentificationSetting({ mode: "artwork", pillAvailable: false }),
    ).toEqual({
      modes: ["artwork", "none"],
      value: "artwork",
    });
  });
});

describe("mergeEnvironmentSettings", () => {
  it("combines the selected environment's server settings with client preferences", () => {
    const serverSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("codex_remote")]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
        },
      },
    };
    const clientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      favorites: [
        {
          provider: ProviderInstanceId.make("codex_remote"),
          model: "gpt-5.4",
        },
      ],
    };

    const settings = mergeEnvironmentSettings(serverSettings, clientSettings);

    expect(settings.providerInstances).toBe(serverSettings.providerInstances);
    expect(settings.favorites).toBe(clientSettings.favorites);
  });
});
