import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SceneryAppearance } from "@t3tools/contracts/settings";

const state = vi.hoisted(() => ({
  appearance: null as SceneryAppearance | null,
  photoSet: null as string | null,
  contrast: 100,
  capable: true,
  hydrated: true,
  updateSettings: vi.fn(),
  persistClientSettings: vi.fn(),
}));

vi.mock("../hooks/useSettings", () => ({
  useUpdatePrimarySettings: () => state.updateSettings,
  useClientSettingsHydrated: () => state.hydrated,
  getClientSettings: () => ({ appearanceContrast: state.contrast }),
  persistClientSettingsPatch: (patch: { appearanceContrast: number }) => {
    state.contrast = patch.appearanceContrast;
    state.persistClientSettings(patch);
    return Promise.resolve();
  },
}));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironmentId: () => "primary",
  useEnvironments: () => ({
    environments: [
      {
        environmentId: "primary",
        connection: { phase: "connected" },
        serverConfig: {
          settings: { sceneryAppearance: state.appearance, sceneryPhotoSet: state.photoSet },
          environment: {
            capabilities: {
              threadAutoSettlement: true,
              sceneryPhotoSet: true,
              sceneryAppearance: state.capable,
            },
          },
        },
      },
    ],
  }),
}));

import { usePhotoSetStore } from "./photoSetStore";
import {
  usePublishSceneryAppearance,
  useSyncedAppearanceContrast,
  useSyncedSceneryPhotoSet,
} from "./useSyncedSceneryPhotoSet";

let renderer: ReactTestRenderer | undefined;
function Sync() {
  useSyncedAppearanceContrast();
  useSyncedSceneryPhotoSet();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(usePhotoSetStore.persist, "hasHydrated").mockReturnValue(true);
  usePhotoSetStore.setState({ photoSetId: "world-scenery" });
  state.appearance = null;
  state.photoSet = null;
  state.contrast = 100;
  state.capable = true;
  state.hydrated = true;
  state.updateSettings.mockReset();
  state.persistClientSettings.mockReset();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount() {
  await act(() => {
    renderer = create(<Sync />);
  });
}

describe("shared contrast and photo collection", () => {
  it("combines rapid slider edits and flushes the last reset when Settings closes", async () => {
    let publish: ReturnType<typeof usePublishSceneryAppearance> | undefined;
    function Publisher() {
      const publishAppearance = usePublishSceneryAppearance();
      useEffect(() => {
        publish = publishAppearance;
      }, [publishAppearance]);
      return null;
    }
    await act(() => {
      renderer = create(<Publisher />);
    });
    vi.useFakeTimers();
    publish!({ blur: 80 });
    publish!({ blur: 0 });
    publish!({ translucency: 0.65 });
    expect(state.updateSettings).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      sceneryAppearance: { blur: 0, translucency: 0.65 },
    });
    state.updateSettings.mockClear();
    publish!({ contrast: 100 });
    await act(() => renderer!.unmount());
    renderer = undefined;
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      sceneryAppearance: { contrast: 100 },
    });
    vi.runAllTimers();
    expect(state.updateSettings).toHaveBeenCalledTimes(1);
  });

  it("adopts the published collection and contrast, then follows remote changes and resets", async () => {
    state.contrast = 150;
    state.appearance = { contrast: 125 };
    state.photoSet = "night-cities";
    await mount();
    expect(state.contrast).toBe(125);
    expect(usePhotoSetStore.getState().photoSetId).toBe("night-cities");

    state.appearance = { contrast: 100 };
    state.photoSet = "world-scenery";
    await act(() => renderer!.update(<Sync />));
    expect(state.contrast).toBe(100);
    expect(usePhotoSetStore.getState().photoSetId).toBe("world-scenery");
    expect(state.updateSettings).not.toHaveBeenCalled();
  });

  it("keeps a local contrast edit while the server save is in flight", async () => {
    state.appearance = { contrast: 125 };
    await mount();
    state.persistClientSettings.mockClear();
    state.contrast = 140;
    await act(() => renderer!.update(<Sync />));
    expect(state.contrast).toBe(140);
    expect(state.persistClientSettings).not.toHaveBeenCalled();
  });

  it("publishes a hydrated legacy contrast only when no shared value exists", async () => {
    state.contrast = 140;
    await mount();
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      sceneryAppearance: { contrast: 140 },
    });
  });

  it.each(["unhydrated", "unsupported", "default"])(
    "does not publish %s contrast",
    async (reason) => {
      state.contrast = reason === "default" ? 100 : 140;
      state.hydrated = reason !== "unhydrated";
      state.capable = reason !== "unsupported";
      await mount();
      expect(state.updateSettings).not.toHaveBeenCalled();
    },
  );
});
