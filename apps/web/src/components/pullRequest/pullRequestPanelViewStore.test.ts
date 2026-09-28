import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  readPullRequestPanelView,
  resetPullRequestPanelViews,
  writePullRequestPanelScroll,
  writePullRequestPanelView,
} from "./pullRequestPanelViewStore";

describe("pull request panel view store", () => {
  beforeEach(() => {
    resetPullRequestPanelViews();
  });

  it("keeps two panels' scroll isolated", () => {
    writePullRequestPanelScroll("thread-a:pr-1", "summary", 420);
    writePullRequestPanelScroll("thread-b:pr-1", "summary", 80);

    expect(readPullRequestPanelView("thread-a:pr-1")?.scrollTopByTab?.summary).toBe(420);
    expect(readPullRequestPanelView("thread-b:pr-1")?.scrollTopByTab?.summary).toBe(80);
  });

  it("remembers the tab and chrome fold beside the scroll offset", () => {
    writePullRequestPanelView("thread-a:pr-1", {
      tab: "timeline",
      chromeCondensedByTab: { timeline: true },
      scrollTopByTab: { timeline: 640 },
    });
    writePullRequestPanelScroll("thread-a:pr-1", "summary", 12);

    expect(readPullRequestPanelView("thread-a:pr-1")).toEqual({
      tab: "timeline",
      chromeCondensedByTab: { timeline: true },
      scrollTopByTab: { timeline: 640, summary: 12 },
    });
  });

  it("does not rewrite when the scroll offset has not moved", () => {
    writePullRequestPanelScroll("thread-a:pr-1", "summary", 200);
    const first = readPullRequestPanelView("thread-a:pr-1");
    writePullRequestPanelScroll("thread-a:pr-1", "summary", 200);
    expect(readPullRequestPanelView("thread-a:pr-1")).toBe(first);
  });

  it("bounds views from long navigation sessions", () => {
    for (let index = 0; index < 140; index += 1) {
      writePullRequestPanelView(`thread-${index}:pr-1`, { tab: "summary" });
    }

    expect(readPullRequestPanelView("thread-0:pr-1")).toBeUndefined();
    expect(readPullRequestPanelView("thread-139:pr-1")?.tab).toBe("summary");
  });
});
