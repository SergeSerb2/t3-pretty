import { describe, expect, it } from "vite-plus/test";

import {
  clearComposerAutoSend,
  composerAutoSendKey,
  composerHoldsQueuedAutoSend,
  pendingComposerAutoSendMatches,
  peekComposerAutoSend,
  queueComposerAutoSend,
  subscribeComposerAutoSend,
  takeComposerAutoSend,
} from "./composerAutoSend";

describe("composer auto-send", () => {
  it("hands the queued keys and prompt to the matching consumer once", () => {
    clearComposerAutoSend();
    const seen: string[] = [];
    const stop = subscribeComposerAutoSend(() => {
      const next = peekComposerAutoSend();
      if (next !== null) seen.push(`${next.keys.join(",")}:${next.prompt}`);
    });
    queueComposerAutoSend(["draft-1", "env-1:thr-1"], "Fix the findings.");
    expect(peekComposerAutoSend()).toEqual({
      keys: ["draft-1", "env-1:thr-1"],
      prompt: "Fix the findings.",
    });
    expect(pendingComposerAutoSendMatches(peekComposerAutoSend(), "env-1:thr-1")).toBe(true);
    expect(takeComposerAutoSend("draft-1", "something else")).toBe(false);
    expect(takeComposerAutoSend("draft-2", "Fix the findings.")).toBe(false);
    expect(takeComposerAutoSend("env-1:thr-1", "Fix the findings.")).toBe(true);
    expect(peekComposerAutoSend()).toBeNull();
    expect(takeComposerAutoSend("draft-1", "Fix the findings.")).toBe(false);
    expect(seen).toEqual(["draft-1,env-1:thr-1:Fix the findings."]);
    stop();
  });

  it("keys a thread the same way the panel addresses its composer", () => {
    expect(composerAutoSendKey({ environmentId: "env-1", threadId: "thr-1" })).toBe("env-1:thr-1");
    expect(composerAutoSendKey("draft-1")).toBe("draft-1");
  });

  it("only sends when the composer still holds the queued task", () => {
    expect(composerHoldsQueuedAutoSend("Fix the findings.", "Fix the findings.")).toBe(true);
    expect(
      composerHoldsQueuedAutoSend("Keep this.\n\nFix the findings.", "Fix the findings."),
    ).toBe(true);
    expect(composerHoldsQueuedAutoSend("a different prompt", "Fix the findings.")).toBe(false);
    expect(composerHoldsQueuedAutoSend("Fix the findings.", "")).toBe(false);
  });
});
