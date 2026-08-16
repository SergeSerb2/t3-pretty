import { describe, expect, it } from "vite-plus/test";

import {
  clampRestoredScrollTop,
  mergePullRequestPanelView,
  pullRequestPanelSessionKey,
  pullRequestPanelViewKey,
} from "./pullRequestPanelView.logic";

describe("pull request panel view keys", () => {
  it("keeps two threads looking at the same pull request apart", () => {
    const reference = { projectId: "proj", repository: "acme/app", number: 12 };
    const threadA = pullRequestPanelViewKey(
      pullRequestPanelSessionKey(
        { environmentId: "env" as never, threadId: "thread-a" as never },
        "env" as never,
      ),
      reference,
    );
    const threadB = pullRequestPanelViewKey(
      pullRequestPanelSessionKey(
        { environmentId: "env" as never, threadId: "thread-b" as never },
        "env" as never,
      ),
      reference,
    );
    expect(threadA).not.toBe(threadB);
  });

  it("scopes the pull-request list page separately from a thread", () => {
    const reference = { projectId: "proj", repository: "acme/app", number: 12 };
    const page = pullRequestPanelViewKey(
      pullRequestPanelSessionKey(undefined, "env" as never),
      reference,
    );
    const thread = pullRequestPanelViewKey(
      pullRequestPanelSessionKey(
        { environmentId: "env" as never, threadId: "thread-a" as never },
        "env" as never,
      ),
      reference,
    );
    expect(page).toMatch(/^page:/);
    expect(page).not.toBe(thread);
  });
});

describe("pull request panel view merge", () => {
  it("writes one tab's scroll without dropping another tab's", () => {
    const merged = mergePullRequestPanelView(
      { tab: "summary", scrollTopByTab: { summary: 240, timeline: 80 } },
      { scrollTopByTab: { summary: 400 } },
    );
    expect(merged.scrollTopByTab).toEqual({ summary: 400, timeline: 80 });
    expect(merged.tab).toBe("summary");
  });

  it("lets a commit selection be cleared back to the whole pull request", () => {
    const merged = mergePullRequestPanelView(
      { selectedCodeCommitOid: "abc" },
      { selectedCodeCommitOid: null },
    );
    expect(merged.selectedCodeCommitOid).toBeNull();
  });
});

describe("restored scroll clamping", () => {
  it("keeps a saved offset that still fits", () => {
    expect(
      clampRestoredScrollTop({
        savedScrollTop: 320,
        scrollHeight: 1200,
        clientHeight: 400,
      }),
    ).toBe(320);
  });

  it("does not scroll past the content that is on screen now", () => {
    expect(
      clampRestoredScrollTop({
        savedScrollTop: 900,
        scrollHeight: 500,
        clientHeight: 400,
      }),
    ).toBe(100);
  });

  it("does not produce a negative offset", () => {
    expect(
      clampRestoredScrollTop({
        savedScrollTop: -20,
        scrollHeight: 500,
        clientHeight: 400,
      }),
    ).toBe(0);
  });
});
