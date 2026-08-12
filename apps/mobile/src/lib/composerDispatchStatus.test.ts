import { describe, expect, it } from "vite-plus/test";

import {
  composerDispatchStatusLabel,
  shouldKeepLocalComposerSendBusy,
} from "./composerDispatchStatus";

describe("composerDispatchStatusLabel", () => {
  it("is silent when the composer is idle", () => {
    expect(composerDispatchStatusLabel({ kind: "idle" })).toBeNull();
  });

  it("names image preparation before the attachments are sendable", () => {
    expect(composerDispatchStatusLabel({ kind: "preparing-images", count: 1 })).toBe(
      "Preparing image...",
    );
    expect(composerDispatchStatusLabel({ kind: "preparing-images", count: 2 })).toBe(
      "Preparing images...",
    );
  });

  it("names new-thread send distinctly from an in-thread send", () => {
    expect(
      composerDispatchStatusLabel({
        kind: "sending",
        creatingThread: true,
        connected: true,
      }),
    ).toBe("Starting thread...");
    expect(
      composerDispatchStatusLabel({
        kind: "sending",
        creatingThread: false,
        connected: true,
      }),
    ).toBe("Sending...");
  });

  it("names the offline queue path instead of a fake send", () => {
    expect(
      composerDispatchStatusLabel({
        kind: "sending",
        creatingThread: true,
        connected: false,
      }),
    ).toBe("Queueing task...");
    expect(
      composerDispatchStatusLabel({
        kind: "sending",
        creatingThread: false,
        connected: false,
      }),
    ).toBe("Queueing...");
  });
});

describe("shouldKeepLocalComposerSendBusy", () => {
  it("holds through the enqueue-to-deliver gap on a live idle thread", () => {
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: false,
        connected: true,
        threadBusy: false,
        queueCount: 1,
      }),
    ).toBe(true);
  });

  it("hands off once the outbox is actually delivering", () => {
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: true,
        connected: true,
        threadBusy: false,
        queueCount: 1,
      }),
    ).toBe(false);
  });

  it("releases when the message is parked behind a running turn or offline", () => {
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: false,
        connected: true,
        threadBusy: true,
        queueCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: false,
        connected: false,
        threadBusy: false,
        queueCount: 1,
      }),
    ).toBe(false);
  });

  it("releases when the outbox has drained", () => {
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: false,
        connected: true,
        threadBusy: false,
        queueCount: 0,
      }),
    ).toBe(false);
  });
});
