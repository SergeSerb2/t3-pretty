import type { NavigationState } from "@react-navigation/native";
import { describe, expect, it, vi } from "vite-plus/test";

import { workspacePathFromState } from "./workspace-path";

const navigationState = (...routeNames: ReadonlyArray<string>) =>
  ({
    index: Math.max(0, routeNames.length - 1),
    routes: routeNames.map((name, index) => ({ key: `${name}-${index}`, name })),
  }) as unknown as NavigationState;

describe("workspacePathFromState", () => {
  it("falls back to Home when a cold state contains only overlays", () => {
    const getPath = vi.fn(() => "/settings");

    expect(workspacePathFromState(navigationState("SettingsSheet"), getPath)).toBe("/");
    expect(getPath).not.toHaveBeenCalled();
  });

  it("resolves the topmost workspace route beneath overlays", () => {
    const getPath = vi.fn((state: NavigationState) => state.routes[state.index]?.name ?? "");

    expect(
      workspacePathFromState(
        navigationState("Home", "ConnectionsNew", "ThreadSettingsSheet"),
        getPath,
      ),
    ).toBe("/Home");
    expect(getPath.mock.calls[0]?.[0].routes.map((route) => route.name)).toEqual(["Home"]);
  });
});
