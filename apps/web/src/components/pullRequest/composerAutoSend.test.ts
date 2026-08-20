import { describe, expect, it } from "vite-plus/test";

import {
  clearComposerAutoSend,
  composerAutoSendKey,
  peekComposerAutoSend,
  queueComposerAutoSend,
  subscribeComposerAutoSend,
  takeComposerAutoSend,
} from "./composerAutoSend";

describe("composer auto-send", () => {
  it("hands the queued key to the matching consumer once", () => {
    clearComposerAutoSend();
    const seen: string[] = [];
    const stop = subscribeComposerAutoSend(() => {
      const pending = peekComposerAutoSend();
      if (pending !== null) seen.push(pending);
    });
    queueComposerAutoSend("draft-1");
    expect(peekComposerAutoSend()).toBe("draft-1");
    expect(takeComposerAutoSend("draft-2")).toBe(false);
    expect(takeComposerAutoSend("draft-1")).toBe(true);
    expect(peekComposerAutoSend()).toBeNull();
    expect(takeComposerAutoSend("draft-1")).toBe(false);
    expect(seen).toEqual(["draft-1"]);
    stop();
  });

  it("keys a thread the same way the panel addresses its composer", () => {
    expect(composerAutoSendKey({ environmentId: "env-1", threadId: "thr-1" })).toBe("env-1:thr-1");
    expect(composerAutoSendKey("draft-1")).toBe("draft-1");
  });
});
