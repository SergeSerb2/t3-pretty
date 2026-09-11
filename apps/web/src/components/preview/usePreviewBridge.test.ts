import {
  ThreadId,
  type DesktopPreviewTabState,
  type PreviewReportStatusInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createPreviewReportTracker,
  previewReportStatusInputsEqual,
  projectDesktopState,
  reportPreviewStatusWithRetry,
} from "./usePreviewBridge";

const favicon = {
  dataUrl: "data:image/png;base64,AAAA",
  pageUrl: "http://localhost:3000/app",
  capturedAt: 1,
};

function state(navStatus: DesktopPreviewTabState["navStatus"]): DesktopPreviewTabState {
  return {
    tabId: "tab-1",
    webContentsId: 1,
    navStatus,
    canGoBack: false,
    canGoForward: false,
    zoomFactor: 1,
    pictureInPicture: false,
    colorScheme: "system",
    audioMuted: false,
    audible: false,
    controller: "none",
    favicon,
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

describe("projectDesktopState", () => {
  it("shows a retained icon only while the current document has the captured origin", () => {
    expect(
      projectDesktopState(
        state({ kind: "Loading", url: "http://localhost:3000/reload", title: "" }),
      ).favicon,
    ).toEqual(favicon);
    expect(
      projectDesktopState(
        state({
          kind: "LoadFailed",
          url: "https://example.com/",
          title: "",
          code: -105,
          description: "failed",
        }),
      ).favicon,
    ).toBeNull();
    expect(projectDesktopState(state({ kind: "Idle" })).favicon).toBeNull();
  });
});

const reportInput = (
  overrides: Partial<PreviewReportStatusInput> = {},
): PreviewReportStatusInput => ({
  threadId: ThreadId.make("thread-1"),
  tabId: "tab-1",
  navStatus: { _tag: "Success", url: "https://example.com/", title: "Example" },
  canGoBack: false,
  canGoForward: false,
  ...overrides,
});

describe("preview report tracking", () => {
  it("compares title and navigation history as part of the report", () => {
    const input = reportInput();
    expect(
      previewReportStatusInputsEqual(input, {
        ...input,
        navStatus: {
          _tag: "Success",
          url: "https://example.com/",
          title: "Updated title",
        },
      }),
    ).toBe(false);
    expect(previewReportStatusInputsEqual(input, { ...input, canGoBack: true })).toBe(false);
  });

  it("allows the current report to retry after a failed delivery", () => {
    const tracker = createPreviewReportTracker();
    const input = reportInput();
    const attempt = tracker.request(input);
    expect(attempt).not.toBeNull();
    tracker.settle(attempt!, false);
    expect(tracker.request(input)).not.toBeNull();
  });

  it("retries one failed delivery without another bridge state event", async () => {
    const tracker = createPreviewReportTracker();
    const input = reportInput();
    let attempts = 0;

    await reportPreviewStatusWithRetry({
      tracker,
      input,
      isCurrent: () => true,
      send: async () => ++attempts === 2,
    });

    expect(attempts).toBe(2);
    expect(tracker.request(input)).toBeNull();
  });

  it("does not let a stale failure roll back a newer request", () => {
    const tracker = createPreviewReportTracker();
    const first = reportInput();
    const second = reportInput({ canGoBack: true });
    const firstAttempt = tracker.request(first);
    const secondAttempt = tracker.request(second);
    tracker.settle(firstAttempt!, false);

    expect(tracker.request(second)).toBeNull();
    tracker.settle(secondAttempt!, true);
    expect(tracker.request(second)).toBeNull();
  });

  it("ignores settlements from a previous subscription", () => {
    const tracker = createPreviewReportTracker();
    const input = reportInput();
    const stale = tracker.request(input);
    tracker.reset();
    const current = tracker.request(input);
    tracker.settle(stale!, false);
    expect(tracker.request(input)).toBeNull();
    tracker.settle(current!, true);
    expect(tracker.request(input)).toBeNull();
  });

  it("continues reporting identical load failures", () => {
    const tracker = createPreviewReportTracker();
    const failure = reportInput({
      navStatus: {
        _tag: "LoadFailed",
        url: "https://example.com/",
        title: "Example",
        code: -105,
        description: "Name not resolved",
      },
    });
    const first = tracker.request(failure);
    tracker.settle(first!, true);
    expect(tracker.request(failure)).not.toBeNull();
  });
});
