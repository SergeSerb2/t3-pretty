import { afterEach, describe, expect, it, vi } from "@effect/vitest";

import {
  projectThreadContentPresentation,
  scheduleThreadLoadingVisibility,
  shouldShowThreadFeedLoadingOverlay,
  threadLoadingPhase,
} from "./threadContentPresentation";

afterEach(() => {
  vi.useRealTimers();
});

describe("thread content presentation", () => {
  it("clears the loading phase as soon as conversation content is ready", () => {
    expect(threadLoadingPhase({ kind: "loading" })).toBe("loading");
    expect(threadLoadingPhase({ kind: "ready" })).toBeNull();
  });

  it("renders cached detail while its environment reconnects", () => {
    expect(
      projectThreadContentPresentation({
        hasDetail: true,
        detailError: null,
        detailDeleted: false,
        connectionState: "reconnecting",
      }),
    ).toEqual({ kind: "ready" });
  });

  it("loads missing detail inside the thread screen when connected", () => {
    expect(
      projectThreadContentPresentation({
        hasDetail: false,
        detailError: null,
        detailDeleted: false,
        connectionState: "connected",
      }),
    ).toEqual({ kind: "loading" });
  });

  it("paints a local starting thread instead of covering it with loading", () => {
    expect(
      projectThreadContentPresentation({
        hasDetail: false,
        detailError: null,
        detailDeleted: false,
        connectionState: "connected",
        hasOptimisticContent: true,
      }),
    ).toEqual({ kind: "ready" });
  });

  it("explains uncached detail while disconnected instead of loading forever", () => {
    expect(
      projectThreadContentPresentation({
        hasDetail: false,
        detailError: null,
        detailDeleted: false,
        connectionState: "error",
      }),
    ).toEqual({
      kind: "unavailable",
      title: "Messages not cached",
      detail: "Reconnect this environment to load the conversation.",
    });
  });

  it("surfaces detail errors before presenting a loading state", () => {
    expect(
      projectThreadContentPresentation({
        hasDetail: false,
        detailError: "The thread stream failed.",
        detailDeleted: false,
        connectionState: "connected",
      }),
    ).toEqual({
      kind: "unavailable",
      title: "Could not load conversation",
      detail: "The thread stream failed.",
    });
  });
});

describe("thread feed loading overlay", () => {
  it("covers the feed while message detail is still loading", () => {
    expect(
      shouldShowThreadFeedLoadingOverlay({
        contentPresentationKind: "loading",
        feedLength: 0,
        listReady: false,
      }),
    ).toBe(true);
  });

  it("covers populated rows until LegendList opens its opacity gate", () => {
    expect(
      shouldShowThreadFeedLoadingOverlay({
        contentPresentationKind: "ready",
        feedLength: 12,
        listReady: false,
      }),
    ).toBe(true);
  });

  it("clears once the list has painted a ready conversation", () => {
    expect(
      shouldShowThreadFeedLoadingOverlay({
        contentPresentationKind: "ready",
        feedLength: 12,
        listReady: true,
      }),
    ).toBe(false);
  });

  it("clears over a painted conversation even if presentation is still loading", () => {
    expect(
      shouldShowThreadFeedLoadingOverlay({
        contentPresentationKind: "loading",
        feedLength: 12,
        listReady: true,
      }),
    ).toBe(false);
  });

  it("does not cover a genuinely empty ready thread", () => {
    expect(
      shouldShowThreadFeedLoadingOverlay({
        contentPresentationKind: "ready",
        feedLength: 0,
        listReady: false,
      }),
    ).toBe(false);
  });
});

describe("thread loading visibility", () => {
  it("cancels a pending loading label when loading finishes during its delay", () => {
    vi.useFakeTimers();
    const visibility: boolean[] = [];
    const cleanup = scheduleThreadLoadingVisibility(true, 300, (visible) =>
      visibility.push(visible),
    );

    cleanup?.();
    vi.advanceTimersByTime(300);

    expect(visibility).toEqual([]);
    scheduleThreadLoadingVisibility(false, 300, (visible) => visibility.push(visible));
    expect(visibility).toEqual([false]);
  });
});
