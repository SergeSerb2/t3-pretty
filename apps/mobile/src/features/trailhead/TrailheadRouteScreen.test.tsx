// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => {
  vi.stubEnv("EXPO_PUBLIC_T3CODE_BUILD_FLAVOR", "public");
  vi.stubEnv("T3CODE_BUILD_FLAVOR", "public");
  return {
    cloudAvailable: false,
    environments: [] as Array<{
      environmentLabel: string;
      connectionState: "connecting" | "connected";
    }>,
    savePreferences: vi.fn(),
    navigate: vi.fn(),
    dispatch: vi.fn(),
  };
});

vi.mock("@effect/atom-react", () => ({ useAtomSet: () => harness.savePreferences }));
vi.mock("@react-navigation/native", async () => {
  const { useEffect } = await import("react");
  return {
    StackActions: { replace: (name: string) => ({ type: "replace", name }) },
    useIsFocused: () => true,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    useNavigation: () => ({
      navigate: harness.navigate,
      dispatch: harness.dispatch,
      canGoBack: () => false,
    }),
  };
});
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success" },
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
}));
vi.mock("expo-notifications", () => ({}));
vi.mock("../../components/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/MaterialButton", () => ({
  MaterialButton: (props: { label: string; onPress: () => void; disabled?: boolean }) => (
    <button disabled={props.disabled} onClick={props.onPress}>
      {props.label}
    </button>
  ),
}));
vi.mock("../../components/T3Wordmark", () => ({ T3Wordmark: () => <span>T3</span> }));
vi.mock("../../lib/motion", () => ({ enterFadeUp: undefined }));
vi.mock("../../lib/runtime", () => ({ runtime: {} }));
vi.mock("../../state/preferences", () => ({ updateMobilePreferencesAtom: {} }));
vi.mock("../../state/workspace", () => ({
  useWorkspaceEnvironments: () => harness.environments,
}));
vi.mock("../agent-awareness/capabilities", () => ({ supportsAgentAwarenessPush: () => false }));
vi.mock("../agent-awareness/notificationPermissions", () => ({
  requestAgentNotificationPermission: {},
}));
vi.mock("../agent-awareness/remoteRegistration", () => ({ refreshAgentAwarenessRegistration: {} }));
vi.mock("../cloud/publicConfig", () => ({ hasCloudPublicConfig: () => harness.cloudAvailable }));
vi.mock("../scenery/SceneryBackdrop", () => ({ SceneryBackdrop: () => null }));
vi.mock("./TrailheadRidge", () => ({ TrailheadRidge: () => null }));

import { TrailheadRouteScreen } from "./TrailheadRouteScreen";

let root: Root;
let container: HTMLDivElement;

function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  expect(button, label).toBeDefined();
  act(() => button!.click());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  harness.cloudAvailable = false;
  harness.environments = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("T3 Pretty first-run setup", () => {
  it("uses the fork CLI and completes the climb after manual pairing without cloud auth", () => {
    act(() => root.render(<TrailheadRouteScreen />));
    expect(container.textContent).toContain("T3Pretty");
    click("Start the climb");
    expect(container.textContent).toContain(
      "npx --yes --package https://github.com/SergeSerb2/t3-pretty/releases/latest/download/t3.tgz t3 pair",
    );
    expect(container.textContent).not.toContain("Sign in to");
    click("Enter it by hand");
    expect(harness.navigate).toHaveBeenLastCalledWith("ConnectionsNew");

    harness.environments = [{ environmentLabel: "Studio Mac", connectionState: "connecting" }];
    act(() => root.render(<TrailheadRouteScreen />));
    act(() => vi.advanceTimersByTime(900));
    expect(container.textContent).toContain("Pair a computer.");
    expect(container.textContent).not.toContain("Roped in.");

    harness.environments = [{ environmentLabel: "Studio Mac", connectionState: "connected" }];
    act(() => root.render(<TrailheadRouteScreen />));
    expect(container.textContent).toContain("Connected to Studio Mac");
    act(() => vi.advanceTimersByTime(900));
    expect(container.textContent).toContain("Summit.");
    click("Start exploring");
    expect(harness.savePreferences).toHaveBeenCalledWith({
      onboardingCompletedAt: expect.any(String),
    });
    expect(harness.dispatch).toHaveBeenCalledWith({ type: "replace", name: "Home" });
  });

  it("offers public T3 Connect alongside manual pairing", () => {
    harness.cloudAvailable = true;
    act(() => root.render(<TrailheadRouteScreen />));
    click("Start the climb");
    click("Sign in to T3 Connect");
    expect(harness.navigate).toHaveBeenLastCalledWith("SettingsSheet", { screen: "SettingsAuth" });
    click("Scan pairing code");
    expect(harness.navigate).toHaveBeenLastCalledWith("ConnectionsNew", { mode: "scan_qr" });
  });
});
