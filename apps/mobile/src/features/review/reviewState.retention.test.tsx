// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId, type ReviewDiffPreviewSource } from "@t3tools/contracts";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "../../state/atom-registry";
import {
  setReviewGitSections,
  setReviewSelectedSectionId,
  setReviewTurnDiff,
  useReviewCacheForThread,
} from "./reviewState";

const environmentId = EnvironmentId.make("env-review-retention");
const threadId = ThreadId.make("thread-review-retention");
const threadKey = `${environmentId}:${threadId}`;
const section: ReviewDiffPreviewSource = {
  id: "working-tree",
  kind: "working-tree",
  title: "Working tree",
  baseRef: "HEAD",
  headRef: null,
  diff: "+changed\n".repeat(100_000),
  diffHash: "large-diff",
  truncated: false,
};

let root: Root;
let latest: ReturnType<typeof useReviewCacheForThread>;
function Probe() {
  const cache = useReviewCacheForThread({ environmentId, threadId });
  useEffect(() => {
    latest = cache;
  });
  return null;
}
function open() {
  act(() =>
    root.render(
      <RegistryContext.Provider value={appAtomRegistry}>
        <Probe />
      </RegistryContext.Provider>,
    ),
  );
}
function close() {
  act(() => root.render(null));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 12));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  setReviewGitSections(threadKey, [section]);
  setReviewTurnDiff(threadKey, "turn:1", section.diff ?? "");
  setReviewSelectedSectionId(threadKey, "turn:1");
});
afterEach(() => {
  act(() => root.unmount());
  appAtomRegistry.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("releases raw diff payloads after 15 idle seconds and keeps lightweight review selection", async () => {
  open();
  expect(latest.gitSections).toEqual([section]);
  expect(latest.turnDiffById["turn:1"]).toBe(section.diff);
  close();
  // The registry rounds expiration to its next one-second sweep bucket.
  await act(() => vi.advanceTimersByTimeAsync(16_001));
  open();
  expect(latest.gitSections.length).toBe(0);
  expect(Object.keys(latest.turnDiffById).length).toBe(0);
  expect(latest.selectedSectionId).toBe("turn:1");
});

it("keeps payloads while a review is open and through a quick return", async () => {
  open();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(latest.gitSections).toEqual([section]);
  close();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  open();
  expect(latest.gitSections).toEqual([section]);
  expect(latest.turnDiffById["turn:1"]).toBe(section.diff);
});
