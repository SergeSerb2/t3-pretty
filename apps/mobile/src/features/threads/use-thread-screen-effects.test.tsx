// @vitest-environment jsdom
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ThreadFeedEntry } from "../../lib/threadActivity";

const harness = vi.hoisted(() => ({
  appState: "active",
  tabActive: true,
  haptic: vi.fn(),
  warning: vi.fn(),
  visit: vi.fn(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return harness.appState;
    },
  },
}));
vi.mock("expo-haptics", () => ({ selectionAsync: harness.haptic }));
vi.mock("../../lib/haptics", () => ({
  hapticError: vi.fn(),
  hapticSuccess: vi.fn(),
  hapticWarning: harness.warning,
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => harness.visit }));
vi.mock("../../state/threads", () => ({ threadEnvironment: { visit: "visit" } }));

import { threadMomentHaptic, useThreadScreenEffects } from "./use-thread-screen-effects";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";

const environmentId = EnvironmentId.make("screen-effects-environment");
const threadId = ThreadId.make("screen-effects-thread");
function thread(updatedAt: string, completed = false, needsInput = false) {
  // This hook only reads visited-watermark, run, and pending-request fields.
  return {
    id: threadId,
    updatedAt,
    lastVisitedAt: "2026-10-13T00:00:00.000Z",
    latestRun: { completedAt: completed ? updatedAt : null },
    hasPendingApprovals: needsInput,
    hasPendingUserInput: false,
  } as EnvironmentThreadShell;
}
function feed(length: number): readonly ThreadFeedEntry[] {
  return [
    {
      type: "message",
      id: "message",
      createdAt: "2026-10-13T00:00:00.000Z",
      message: {
        id: MessageId.make("message"),
        role: "assistant",
        text: "x".repeat(length),
        streaming: true,
        attachments: [],
        runId: null,
        visibility: "local",
        sourceThreadId: threadId,
        createdAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
      },
    },
  ];
}
let root: Root;
function Probe(props: {
  readonly environmentId: EnvironmentId;
  readonly visible: boolean;
  readonly textLength: number;
  readonly updatedAt: string;
  readonly completed: boolean;
  readonly needsInput: boolean;
}) {
  useThreadScreenEffects({
    environmentId: props.environmentId,
    selectedThread: thread(props.updatedAt, props.completed, props.needsInput),
    feed: feed(props.textLength),
    visible: props.visible,
  });
  return null;
}
function render(
  input: {
    readonly environmentId?: EnvironmentId;
    readonly visible?: boolean;
    readonly length?: number;
    readonly updatedAt?: string;
    readonly completed?: boolean;
    readonly needsInput?: boolean;
  } = {},
) {
  act(() =>
    root.render(
      <NativeWorkspaceTabActivityContext
        value={{ active: harness.tabActive, isActive: () => harness.tabActive }}
      >
        <Probe
          environmentId={input.environmentId ?? environmentId}
          visible={input.visible ?? true}
          textLength={input.length ?? 1}
          updatedAt={input.updatedAt ?? "2026-10-13T00:00:00.000Z"}
          completed={input.completed ?? false}
          needsInput={input.needsInput ?? false}
        />
      </NativeWorkspaceTabActivityContext>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ now: new Date("2026-10-13T00:00:20.000Z") });
  harness.appState = "active";
  harness.tabActive = true;
  harness.haptic.mockReset().mockResolvedValue(undefined);
  harness.warning.mockReset();
  harness.visit.mockReset().mockResolvedValue(undefined);
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps hidden streams quiet and seeds resumed text without a catch-up haptic", () => {
  render({ visible: false });
  act(() => vi.advanceTimersByTime(400));
  render({ visible: false, length: 20 });
  expect(harness.haptic).not.toHaveBeenCalled();
  render({ length: 40 });
  expect(harness.haptic).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(400));
  render({ length: 41 });
  expect(harness.haptic).toHaveBeenCalledTimes(1);
});

it("does not emit haptics for an inactive app or tab even before visibility cleanup", () => {
  render();
  harness.appState = "background";
  render({ length: 20 });
  expect(harness.haptic).not.toHaveBeenCalled();
  harness.appState = "active";
  render({ length: 30 });
  harness.tabActive = false;
  render({ length: 40 });
  expect(harness.haptic).not.toHaveBeenCalled();
});

it("seeds a different environment's same-named thread without a catch-up haptic", () => {
  render();
  act(() => vi.advanceTimersByTime(400));
  render({ length: 20 });
  expect(harness.haptic).toHaveBeenCalledTimes(1);
  const otherEnvironment = EnvironmentId.make("another-screen-effects-environment");
  act(() => vi.advanceTimersByTime(400));
  render({ environmentId: otherEnvironment, length: 100 });
  expect(harness.haptic).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(400));
  render({ environmentId: otherEnvironment, length: 101 });
  expect(harness.haptic).toHaveBeenCalledTimes(2);
});

it("does not clear a hidden thread's completion marker and records the latest watermark when revealed", () => {
  render({ visible: false, completed: true, updatedAt: "2026-10-13T00:00:01.000Z" });
  render({ visible: false, completed: true, updatedAt: "2026-10-13T00:00:02.000Z" });
  expect(harness.visit).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  render({ completed: true, updatedAt: "2026-10-13T00:00:02.000Z" });
  expect(harness.visit).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { threadId, visitedAt: "2026-10-13T00:00:02.000Z" },
  });
});

it("cancels a pending streaming watermark timer when its screen is covered", () => {
  render({ updatedAt: "2026-10-13T00:00:01.000Z" });
  expect(harness.visit).toHaveBeenCalledTimes(1);
  render({ updatedAt: "2026-10-13T00:00:02.000Z" });
  expect(vi.getTimerCount()).toBe(1);
  render({ visible: false, updatedAt: "2026-10-13T00:00:02.000Z" });
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(20_000));
  expect(harness.visit).toHaveBeenCalledTimes(1);
  render({ updatedAt: "2026-10-13T00:00:03.000Z" });
  expect(harness.visit).toHaveBeenLastCalledWith({
    environmentId,
    input: { threadId, visitedAt: "2026-10-13T00:00:03.000Z" },
  });
});

it.each(["app", "tab"])(
  "does not dispatch an already queued watermark after the %s becomes inactive",
  (inactive) => {
    render({ updatedAt: "2026-10-13T00:00:01.000Z" });
    render({ updatedAt: "2026-10-13T00:00:02.000Z" });
    expect(vi.getTimerCount()).toBe(1);
    if (inactive === "app") harness.appState = "background";
    else harness.tabActive = false;
    act(() => vi.advanceTimersByTime(10_000));
    expect(harness.visit).toHaveBeenCalledTimes(1);
  },
);

it("asks for attention on a new request but not on one that follows an answer", () => {
  render();
  render({ needsInput: true });
  expect(harness.warning).toHaveBeenCalledTimes(1);
  render({ needsInput: false });
  render({ needsInput: true });
  expect(harness.warning).toHaveBeenCalledTimes(1);
  render({ needsInput: false });
  act(() => vi.advanceTimersByTime(2_000));
  render({ needsInput: true });
  expect(harness.warning).toHaveBeenCalledTimes(2);
});

describe("threadMomentHaptic", () => {
  const moment = (status: string | null, needsInput = false, runId: string | null = "run-1") => ({
    runId,
    status,
    needsInput,
  });

  it("marks the watched turn settling with its outcome", () => {
    expect(threadMomentHaptic(moment("running"), moment("completed"))).toBe("success");
    expect(threadMomentHaptic(moment("starting"), moment("failed"))).toBe("error");
  });

  it("stays quiet for interrupts, already settled runs, and a different run", () => {
    expect(threadMomentHaptic(moment("running"), moment("interrupted"))).toBeNull();
    expect(threadMomentHaptic(moment("completed"), moment("completed"))).toBeNull();
    expect(threadMomentHaptic(moment("running"), moment("completed", false, "run-2"))).toBeNull();
    expect(threadMomentHaptic(moment(null, false, null), moment("completed"))).toBeNull();
  });

  it("asks for attention once when the agent starts waiting on the user", () => {
    expect(threadMomentHaptic(moment("running"), moment("waiting", true))).toBe("warning");
    expect(threadMomentHaptic(moment("waiting", true), moment("waiting", true))).toBeNull();
  });
});
