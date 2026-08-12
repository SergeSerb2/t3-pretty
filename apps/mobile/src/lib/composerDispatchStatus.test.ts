import { describe, expect, it } from "vite-plus/test";

import { composerDispatchStatusLabel } from "./composerDispatchStatus";

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
        hasImages: false,
      }),
    ).toBe("Starting thread...");
    expect(
      composerDispatchStatusLabel({
        kind: "sending",
        creatingThread: true,
        connected: true,
        hasImages: true,
      }),
    ).toBe("Sending images...");
    expect(
      composerDispatchStatusLabel({
        kind: "sending",
        creatingThread: false,
        connected: true,
        hasImages: true,
      }),
    ).toBe("Sending images...");
  });

  it("names the offline queue path instead of a fake send", () => {
    expect(
      composerDispatchStatusLabel({
        kind: "sending",
        creatingThread: true,
        connected: false,
        hasImages: true,
      }),
    ).toBe("Queueing images...");
    expect(
      composerDispatchStatusLabel({
        kind: "sending",
        creatingThread: true,
        connected: false,
        hasImages: false,
      }),
    ).toBe("Queueing task...");
  });
});
