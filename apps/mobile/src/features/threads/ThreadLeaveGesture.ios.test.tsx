// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { ThreadLeaveGesture } from "./ThreadLeaveGesture.ios";

type SwipeEvent = {
  translationX: number;
  translationY: number;
  velocityX: number;
  canceled: boolean;
};
type SwipeCallbacks = {
  onActivate: (event: SwipeEvent) => void;
  onUpdate: (event: SwipeEvent) => void;
  onDeactivate: (event: SwipeEvent) => void;
};

const harness = vi.hoisted(() => ({
  pan: undefined as SwipeCallbacks | undefined,
  focused: true,
  rnQueue: [] as Array<() => void>,
  events: [] as string[],
}));

vi.mock("@react-navigation/native", () => ({
  useIsFocused: () => harness.focused,
  useNavigation: () => ({ isFocused: () => harness.focused }),
}));
vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light" },
  impactAsync: () => {
    harness.events.push("haptic");
    return Promise.resolve();
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: { children: ReactNode }) => children,
  useNativeGesture: () => ({}),
  usePanGesture: (callbacks: SwipeCallbacks) => {
    harness.pan = callbacks;
    return { handlerTag: 1 };
  },
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: ({ children }: { children: ReactNode }) => <div>{children}</div> },
  useReducedMotion: () => false,
  useAnimatedStyle: (style: () => unknown) => style(),
  useSharedValue: <T,>(initial: T) => {
    const [shared] = useState(() => {
      let value = initial;
      return {
        get: () => value,
        set: (next: T) => {
          value = next;
        },
      };
    });
    return shared;
  },
  withSpring: (target: number) => target,
}));
vi.mock("react-native-worklets", () => ({
  scheduleOnRN: (callback: () => void) => harness.rnQueue.push(callback),
}));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../lib/motion", () => ({ MOTION_PRESS_SPRING: { duration: 120 } }));
vi.mock("../layout/AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({ layout: { usesSplitView: false } }),
}));
vi.mock("../workspace/useAndroidWorkspaceNavigation", () => ({
  useWorkspaceListNavigation: () => () => harness.events.push("leave"),
}));

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  harness.focused = true;
  harness.pan = undefined;
  harness.rnQueue.length = 0;
  harness.events.length = 0;
  root = createRoot(document.createElement("div"));
  act(() => root.render(<ThreadLeaveGesture>Conversation</ThreadLeaveGesture>));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

function callbacks() {
  if (!harness.pan) throw new Error("The thread leave gesture did not mount");
  return harness.pan;
}
function flushRN() {
  for (const callback of harness.rnQueue.splice(0)) callback();
}
const start = { translationX: 30, translationY: 4, velocityX: 100, canceled: false };
const longSwipe = { ...start, translationX: 120 };

it.each([
  ["cancelled", { ...longSwipe, canceled: true }],
  ["reversed", { ...longSwipe, velocityX: -300 }],
])("keeps the thread open when a long drag is %s before queued navigation runs", (_, end) => {
  const pan = callbacks();
  pan.onActivate(start);
  pan.onUpdate(longSwipe);
  pan.onDeactivate(end);
  flushRN();
  expect(harness.events).toEqual([]);
});

it.each([
  ["a steady swipe", longSwipe],
  ["a short flick", { ...start, velocityX: 900 }],
])("leaves once with a haptic when %s finishes", (_, end) => {
  const pan = callbacks();
  pan.onActivate(start);
  pan.onUpdate(end);
  flushRN();
  expect(harness.events).toEqual([]);

  pan.onDeactivate(end);
  flushRN();
  expect(harness.events).toEqual(["haptic", "leave"]);

  pan.onDeactivate(end);
  flushRN();
  expect(harness.events).toEqual(["haptic", "leave"]);
});

it("accepts a new swipe after a cancelled long drag", () => {
  const pan = callbacks();
  pan.onActivate(start);
  pan.onUpdate(longSwipe);
  pan.onDeactivate({ ...longSwipe, canceled: true });
  flushRN();
  expect(harness.events).toEqual([]);

  pan.onActivate(start);
  pan.onUpdate(longSwipe);
  pan.onDeactivate(longSwipe);
  flushRN();
  expect(harness.events).toEqual(["haptic", "leave"]);
});

it("skips queued navigation and haptics if the thread loses focus", () => {
  const pan = callbacks();
  pan.onActivate(start);
  pan.onUpdate(longSwipe);
  pan.onDeactivate(longSwipe);
  harness.focused = false;
  flushRN();
  expect(harness.events).toEqual([]);
});
