import { describe, expect, it } from "vite-plus/test";

import {
  acquirePreviewGuestThread,
  readAutomatingPreviewThreads,
  resolveResidentPreviewThreads,
} from "./previewGuestResidency";

const residency = (input: {
  threadKeys: readonly string[];
  pinnedKeys?: readonly string[];
  lastPinnedAt?: Record<string, number>;
  limit?: number;
}) =>
  resolveResidentPreviewThreads({
    threadKeys: input.threadKeys,
    pinnedKeys: new Set(input.pinnedKeys ?? []),
    lastPinnedAt: new Map(Object.entries(input.lastPinnedAt ?? {})),
    limit: input.limit ?? 3,
  });

describe("preview guest residency", () => {
  it("keeps every thread while the budget is not exceeded", () => {
    expect([...residency({ threadKeys: ["a", "b", "c"] })].sort()).toEqual(["a", "b", "c"]);
  });

  it("evicts the least recently pinned threads past the budget", () => {
    const resident = residency({
      threadKeys: ["a", "b", "c", "d"],
      lastPinnedAt: { a: 40, b: 10, c: 30, d: 20 },
      limit: 2,
    });

    expect([...resident].sort()).toEqual(["a", "c"]);
  });

  it("never evicts a thread that is doing something, even past the budget", () => {
    const resident = residency({
      threadKeys: ["visible", "recording", "idle-new", "idle-old"],
      pinnedKeys: ["visible", "recording"],
      lastPinnedAt: { "idle-new": 100, "idle-old": 1 },
      limit: 1,
    });

    expect([...resident].sort()).toEqual(["recording", "visible"]);
  });

  it("counts automation acquisitions until the last one releases", () => {
    const first = acquirePreviewGuestThread("thread-1");
    const second = acquirePreviewGuestThread("thread-1");
    expect([...readAutomatingPreviewThreads()]).toEqual(["thread-1"]);

    first();
    expect([...readAutomatingPreviewThreads()]).toEqual(["thread-1"]);
    // Releasing twice must not drop another request's hold.
    first();
    expect([...readAutomatingPreviewThreads()]).toEqual(["thread-1"]);

    second();
    expect([...readAutomatingPreviewThreads()]).toEqual([]);
  });
});
