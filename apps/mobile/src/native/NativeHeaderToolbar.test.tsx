// @vitest-environment jsdom
import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HeaderBarButtonSearchBarPlacementItem } from "react-native-screens";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  options: {} as Record<
    string,
    (() => Array<NativeStackHeaderItem | HeaderBarButtonSearchBarPlacementItem>) | undefined
  >,
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    setOptions: (options: typeof harness.options) => Object.assign(harness.options, options),
  }),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("./native-glass", () => ({ NATIVE_LIQUID_GLASS_SUPPORTED: true }));
vi.mock("../components/MintGlassButton", () => ({ MintGlassButton: () => null }));
vi.mock("../components/ControlPillMenu", () => ({ ControlPillMenu: () => null }));

import { NativeHeaderToolbar } from "./NativeHeaderToolbar";
import { NativeStackScreenOptions } from "./StackHeader";
import { mintGlassBackOptions } from "./mintGlassHeaderItems";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  harness.options = {};
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it.each(["left", "right", "bottom"] as const)(
  "keeps native buttons, menus and spacing in the %s toolbar",
  (placement) => {
    const onPress = vi.fn();
    const onAction = vi.fn();
    act(() =>
      root.render(
        <NativeHeaderToolbar placement={placement}>
          <NativeHeaderToolbar.Button icon="plus" label="New chat" onPress={onPress} />
          <NativeHeaderToolbar.Spacer width={12} />
          <NativeHeaderToolbar.Menu icon="ellipsis" title="More">
            <NativeHeaderToolbar.MenuAction onPress={onAction} isOn>
              Show archived
            </NativeHeaderToolbar.MenuAction>
          </NativeHeaderToolbar.Menu>
          <NativeHeaderToolbar.Custom>
            <span>Busy</span>
          </NativeHeaderToolbar.Custom>
          <NativeHeaderToolbar.SearchBarSlot />
        </NativeHeaderToolbar>,
      ),
    );
    const key =
      placement === "bottom"
        ? "unstable_headerToolbarItems"
        : placement === "left"
          ? "unstable_headerLeftItems"
          : "unstable_headerRightItems";
    const items = harness.options[key]?.();
    expect(items?.map((item) => item.type)).toEqual([
      "button",
      "spacing",
      "menu",
      "custom",
      ...(placement === "bottom" ? ["searchBarPlacement"] : []),
    ]);
    const button = items?.[0];
    if (button?.type !== "button") throw new Error("Expected a native button");
    button.onPress();
    expect(onPress).toHaveBeenCalledOnce();
    const menu = items?.[2];
    if (menu?.type !== "menu") throw new Error("Expected a native menu");
    const action = menu.menu.items[0];
    if (action?.type !== "action") throw new Error("Expected a native menu action");
    expect(action.state).toBe("on");
    action.onPress();
    expect(onAction).toHaveBeenCalledOnce();
    expect(items?.[3]).toMatchObject({ type: "custom", element: <span>Busy</span> });
  },
);

it("keeps native item factories supplied through screen options", () => {
  const onPress = vi.fn();
  const items: NativeStackHeaderItem[] = [
    { type: "button", label: "New chat", icon: { type: "sfSymbol", name: "plus" }, onPress },
  ];
  act(() =>
    root.render(
      <NativeStackScreenOptions
        options={{
          unstable_headerRightItems: () => items,
          unstable_headerToolbarItems: () => items,
        }}
      />,
    ),
  );
  expect(harness.options.unstable_headerRightItems?.()).toEqual(items);
  expect(harness.options.unstable_headerToolbarItems?.()).toEqual(items);
});

it("uses native back buttons only on a screen with a previous route", () => {
  const goBack = vi.fn();
  const navigation = { goBack, getState: () => ({ routes: [{ key: "root" }, { key: "thread" }] }) };
  const options = mintGlassBackOptions({ navigation, route: { key: "thread" } });
  const back = options.unstable_headerLeftItems?.()[0];
  expect(back?.type).toBe("button");
  if (back?.type !== "button") throw new Error("Expected a native back button");
  back.onPress();
  expect(goBack).toHaveBeenCalledOnce();
  expect(
    mintGlassBackOptions({ navigation, route: { key: "root" } }).unstable_headerLeftItems,
  ).toBeUndefined();
});
