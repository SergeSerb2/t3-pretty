import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SceneryAppearance } from "@t3tools/contracts/settings";

const state = vi.hoisted(() => ({
  shared: {} as SceneryAppearance,
  updateSettings: vi.fn(),
}));

vi.mock("../hooks/useSettings", () => ({
  useUpdatePrimarySettings: () => state.updateSettings,
}));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      {
        connection: { phase: "connected" },
        serverConfig: {
          environment: { capabilities: { threadAutoSettlement: true, sceneryAppearance: true } },
        },
      },
    ],
  }),
}));
vi.mock("./useSyncedSceneryPhotoSet", () => ({
  useSharedSceneryAppearance: () => state.shared,
}));

import { DEFAULT_TRANSLUCENCY } from "./glass";
import { DEFAULT_BLUR, useSceneryStore } from "./sceneryStore";
import { useSyncedSceneryAppearance } from "./useSyncedSceneryAppearance";

let renderer: ReactTestRenderer | undefined;
function Sync() {
  useSyncedSceneryAppearance();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(useSceneryStore.persist, "hasHydrated").mockReturnValue(true);
  useSceneryStore.setState({ blur: DEFAULT_BLUR, translucency: DEFAULT_TRANSLUCENCY });
  state.shared = {};
  state.updateSettings.mockReset();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(() => {
    renderer = create(<Sync />);
  });
}

describe("scenery appearance sync", () => {
  it("adopts shared values over saved device values, then follows another device's reset without echoing it", async () => {
    useSceneryStore.setState({ blur: 80, translucency: 0.65 });
    state.shared = { blur: 0, translucency: 1 };
    await mount();
    expect(useSceneryStore.getState()).toMatchObject({ blur: 0, translucency: 1 });
    expect(state.updateSettings).not.toHaveBeenCalled();

    state.shared = { blur: DEFAULT_BLUR, translucency: DEFAULT_TRANSLUCENCY };
    await act(() => renderer!.update(<Sync />));
    expect(useSceneryStore.getState()).toMatchObject(state.shared);
    expect(state.updateSettings).not.toHaveBeenCalled();
  });

  it("migrates only unpublished, customized fields", async () => {
    useSceneryStore.setState({ blur: 80, translucency: 0.65 });
    state.shared = { blur: 20 };
    await mount();
    expect(useSceneryStore.getState()).toMatchObject({ blur: 20, translucency: 0.65 });
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      sceneryAppearance: { translucency: 0.65 },
    });
  });

  it("does not publish defaults on first connection", async () => {
    await mount();
    expect(state.updateSettings).not.toHaveBeenCalled();
  });

  it("waits for device hydration before publishing", async () => {
    useSceneryStore.setState({ blur: 80 });
    vi.mocked(useSceneryStore.persist.hasHydrated).mockReturnValue(false);
    await mount();
    expect(state.updateSettings).not.toHaveBeenCalled();
  });
});
