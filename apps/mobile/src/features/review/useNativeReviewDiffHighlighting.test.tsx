// @vitest-environment jsdom
import { act, useEffect, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { highlightNativeReviewDiffVisibleRows } from "../diffs/nativeReviewDiffHighlighter";

const harness = vi.hoisted(() => ({
  focused: true,
  appState: "active",
  focusListeners: new Set<() => void>(),
  appListeners: new Set<() => void>(),
  highlight: vi.fn(),
}));
vi.mock("@react-navigation/native", () => ({
  useIsFocused: () =>
    useSyncExternalStore(
      (listener) => {
        harness.focusListeners.add(listener);
        return () => harness.focusListeners.delete(listener);
      },
      () => harness.focused,
    ),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return harness.appState;
    },
    addEventListener: (_event: string, listener: () => void) => {
      harness.appListeners.add(listener);
      return { remove: () => harness.appListeners.delete(listener) };
    },
  },
}));
vi.mock("../diffs/nativeReviewDiffHighlighter", () => ({
  highlightNativeReviewDiffVisibleRows: harness.highlight,
}));

import { useNativeReviewDiffHighlighting } from "./useNativeReviewDiffHighlighting";

type HighlightInput = Parameters<typeof highlightNativeReviewDiffVisibleRows>[0];
type HighlightResult = Awaited<ReturnType<typeof highlightNativeReviewDiffVisibleRows>>;
const rows = Array.from({ length: 400 }, (_, index) => ({
  id: `row-${index}`,
  kind: "line" as const,
  content: `const value = ${index};`,
}));
const files: HighlightInput["files"] = [];
const requests: Array<{
  readonly input: HighlightInput;
  readonly highlightedIds: readonly string[];
  readonly resolve: (result: HighlightResult) => void;
}> = [];
let latest: ReturnType<typeof useNativeReviewDiffHighlighting>;
let root: Root;

function Probe(props: { readonly enabled: boolean }) {
  const highlighting = useNativeReviewDiffHighlighting({
    enabled: props.enabled,
    files,
    rows,
    scheme: "light",
    resetKey: "stable-review",
  });
  useEffect(() => {
    latest = highlighting;
  });
  return null;
}
function render(enabled = true) {
  act(() => root.render(<Probe enabled={enabled} />));
}
function focus(focused: boolean) {
  act(() => {
    harness.focused = focused;
    for (const listener of harness.focusListeners) listener();
  });
}
async function resolve(index: number, rowId: string | null) {
  await act(async () => {
    requests[index]!.resolve({
      engine: "native",
      rowCount: rowId === null ? 0 : 1,
      durationMs: 1,
      tokensByRowId:
        rowId === null ? {} : { [rowId]: [{ content: "const", color: "blue", fontStyle: 0 }] },
    });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  harness.focused = true;
  harness.appState = "active";
  requests.length = 0;
  harness.highlight.mockReset().mockImplementation(
    (input: HighlightInput) =>
      new Promise<HighlightResult>((complete) => {
        requests.push({
          input,
          highlightedIds: [...(input.alreadyHighlightedRowIds ?? [])],
          resolve: complete,
        });
      }),
  );
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("does no visible-row highlighting for an already covered review route", () => {
  harness.focused = false;
  render();
  expect(harness.highlight).not.toHaveBeenCalled();
});

it("does no visible-row highlighting while the app starts in the background", () => {
  harness.appState = "background";
  render();
  expect(harness.highlight).not.toHaveBeenCalled();
});

it("preserves completed tokens and the viewport through disabling and a return", async () => {
  render();
  await resolve(0, "row-1");
  act(() => latest.updateVisibleRange({ firstRowIndex: 200, lastRowIndex: 280 }));
  await resolve(1, "row-200");
  const patch = latest.tokensPatchJson;
  render(false);
  expect(latest.tokensPatchJson).toBe(patch);
  render();
  expect(requests[2]?.input.firstRowIndex).toBe(200);
  expect(requests[2]?.highlightedIds).toEqual(["row-1", "row-200"]);
  await resolve(2, null);
  expect(latest.tokensPatchJson).toBe(patch);
});

it("cancels queued scroll work on blur and ignores hidden native draw events", async () => {
  render();
  await resolve(0, "row-1");
  act(() => latest.updateVisibleRange({ firstRowIndex: 2, lastRowIndex: 82 }));
  expect(vi.getTimerCount()).toBe(1);
  focus(false);
  act(() => latest.updateVisibleRange({ firstRowIndex: 200, lastRowIndex: 280 }));
  act(() => vi.advanceTimersByTime(1_000));
  expect(harness.highlight).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  focus(true);
  expect(requests[1]?.input.firstRowIndex).toBe(0);
});

it("aborts active row work on blur and ignores its late completion", async () => {
  render();
  const emptyPatch = latest.tokensPatchJson;
  focus(false);
  expect(requests[0]?.input.signal?.aborted).toBe(true);
  await resolve(0, "obsolete-row");
  expect(latest.tokensPatchJson).toBe(emptyPatch);
  focus(true);
  expect(requests[1]?.highlightedIds).toEqual([]);
});
