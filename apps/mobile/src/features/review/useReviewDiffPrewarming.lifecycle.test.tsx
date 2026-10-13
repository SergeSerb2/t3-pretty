// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const appState = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>();
  return {
    currentState: "active",
    listeners,
    change(state: string) {
      appState.currentState = state;
      for (const listener of listeners) listener(state);
    },
  };
});
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listeners.add(listener);
      return { remove: () => appState.listeners.delete(listener) };
    },
  },
}));

import { appAtomRegistry } from "../../state/atom-registry";
import * as ReviewModel from "./reviewModel";
import { useReviewDiffPrewarming } from "./useReviewDiffPrewarming";

const sections = Array.from({ length: 6 }, (_, index) => ({
  id: `turn:${index}`,
  kind: "turn" as const,
  title: `Turn ${index}`,
  subtitle: null,
  isLoading: false,
  diff: [
    `diff --git a/file${index}.ts b/file${index}.ts`,
    "--- /dev/null",
    `+++ b/file${index}.ts`,
    "@@ -0,0 +1 @@",
    `+export const value = ${index};`,
  ].join("\n"),
}));

let root: Root;
function Probe(props: { readonly enabled: boolean }) {
  useReviewDiffPrewarming({
    enabled: props.enabled,
    sections,
    selectedSectionId: "turn:0",
    threadKey: "env:review-prewarm-lifecycle",
  });
  return null;
}

function render(enabled = true) {
  act(() => root.render(<Probe enabled={enabled} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  appState.currentState = "active";
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  appAtomRegistry.reset();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("cancels idle parsing in the background and resumes only in the foreground", () => {
  const parse = vi.spyOn(ReviewModel, "buildReviewParsedDiff");
  render();
  act(() => vi.advanceTimersByTime(100));
  expect(parse).toHaveBeenCalledTimes(1);

  act(() => appState.change("background"));
  act(() => vi.advanceTimersByTime(10_000));
  expect(parse).toHaveBeenCalledTimes(1);
  act(() => appState.change("inactive"));
  act(() => vi.advanceTimersByTime(10_000));
  expect(parse).toHaveBeenCalledTimes(1);

  act(() => appState.change("active"));
  act(() => vi.advanceTimersByTime(1_000));
  expect(parse).toHaveBeenCalledTimes(4);
});

it("does no speculative parsing when initially backgrounded", () => {
  appState.currentState = "background";
  const parse = vi.spyOn(ReviewModel, "buildReviewParsedDiff");
  render();
  act(() => vi.advanceTimersByTime(10_000));
  expect(parse).not.toHaveBeenCalled();
});

it("cancels queued work when disabled or unmounted", () => {
  const parse = vi.spyOn(ReviewModel, "buildReviewParsedDiff");
  render();
  render(false);
  act(() => vi.advanceTimersByTime(1_000));
  expect(parse).not.toHaveBeenCalled();
  render();
  act(() => root.unmount());
  act(() => vi.advanceTimersByTime(1_000));
  expect(parse).not.toHaveBeenCalled();
  expect(appState.listeners.size).toBe(0);
});

it("cancels native idle callbacks and skips a background callback before effect cleanup", () => {
  const callbacks = new Map<number, IdleRequestCallback>();
  let handle = 0;
  const requestIdle = vi.fn((callback: IdleRequestCallback) => {
    callbacks.set(++handle, callback);
    return handle;
  });
  const cancelIdle = vi.fn((pendingHandle: number) => callbacks.delete(pendingHandle));
  vi.stubGlobal("requestIdleCallback", requestIdle);
  vi.stubGlobal("cancelIdleCallback", cancelIdle);
  const parse = vi.spyOn(ReviewModel, "buildReviewParsedDiff");
  render();
  expect(requestIdle).toHaveBeenCalledTimes(1);
  const queued = callbacks.get(1)!;

  act(() => {
    appState.change("background");
    // AppState has changed, but React has not cleaned up the old effect yet.
    expect(cancelIdle).not.toHaveBeenCalled();
    queued({ didTimeout: false, timeRemaining: () => 20 });
  });
  expect(parse).not.toHaveBeenCalled();
  expect(cancelIdle).toHaveBeenCalledWith(1);
  expect(callbacks.size).toBe(0);

  act(() => appState.change("active"));
  const resumed = callbacks.get(2)!;
  callbacks.delete(2);
  act(() => resumed({ didTimeout: false, timeRemaining: () => 20 }));
  expect(parse).toHaveBeenCalledTimes(1);
  expect(callbacks.has(3)).toBe(true);
  render(false);
  expect(cancelIdle).toHaveBeenCalledWith(3);
  expect(callbacks.size).toBe(0);
});
