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
  it("holds through the enqueue-to-deliver gap when this send is next", () => {
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: false,
        isAwaitingEnqueue: false,
        connected: true,
        threadBusy: false,
        isNextInQueue: true,
        isWaitingForRetry: false,
      }),
    ).toBe(true);
  });

  it("holds while enqueue has not returned a message id yet", () => {
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: false,
        isAwaitingEnqueue: true,
        connected: true,
        threadBusy: false,
        isNextInQueue: false,
        isWaitingForRetry: false,
      }),
    ).toBe(true);
  });

  it("hands off once the outbox is actually delivering", () => {
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: true,
        isAwaitingEnqueue: false,
        connected: true,
        threadBusy: false,
        isNextInQueue: true,
        isWaitingForRetry: false,
      }),
    ).toBe(false);
  });

  it("releases when the message is parked behind a running turn, retry, or offline", () => {
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: false,
        isAwaitingEnqueue: false,
        connected: true,
        threadBusy: true,
        isNextInQueue: true,
        isWaitingForRetry: false,
      }),
    ).toBe(false);
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: false,
        isAwaitingEnqueue: false,
        connected: false,
        threadBusy: false,
        isNextInQueue: true,
        isWaitingForRetry: false,
      }),
    ).toBe(false);
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: false,
        isAwaitingEnqueue: false,
        connected: true,
        threadBusy: false,
        isNextInQueue: false,
        isWaitingForRetry: false,
      }),
    ).toBe(false);
    expect(
      shouldKeepLocalComposerSendBusy({
        isDeliveringQueuedMessage: false,
        isAwaitingEnqueue: false,
        connected: true,
        threadBusy: false,
        isNextInQueue: true,
        isWaitingForRetry: true,
      }),
    ).toBe(false);
  });
});
