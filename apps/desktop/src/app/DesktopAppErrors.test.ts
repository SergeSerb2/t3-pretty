import { assert, describe, it } from "@effect/vitest";

import {
  DesktopBackendPortUnavailableError,
  DesktopDevelopmentBackendPortRequiredError,
  DESKTOP_FATAL_STARTUP_DETAIL_MAX_LENGTH,
  DESKTOP_FATAL_STARTUP_MESSAGE_MAX_LENGTH,
  formatFatalStartupError,
} from "./DesktopApp.ts";

describe("DesktopApp errors", () => {
  it("preserves unavailable backend port context", () => {
    const error = new DesktopBackendPortUnavailableError({
      startPort: 3_773,
      maxPort: 65_535,
      hosts: ["127.0.0.1", "0.0.0.0", "::"],
    });

    assert.equal(error.startPort, 3_773);
    assert.equal(error.maxPort, 65_535);
    assert.deepEqual(error.hosts, ["127.0.0.1", "0.0.0.0", "::"]);
    assert.equal(
      error.message,
      "No desktop backend port is available on hosts 127.0.0.1, 0.0.0.0, :: between 3773 and 65535.",
    );
  });

  it("reports the required development port", () => {
    const error = new DesktopDevelopmentBackendPortRequiredError();

    assert.equal(error.message, "T3CODE_PORT is required in desktop development.");
  });

  it("bounds fatal startup diagnostics before they reach logs and native dialogs", () => {
    const error = new Error("m".repeat(DESKTOP_FATAL_STARTUP_MESSAGE_MAX_LENGTH + 1_000));
    error.stack = "s".repeat(DESKTOP_FATAL_STARTUP_DETAIL_MAX_LENGTH + 1_000);

    const diagnostic = formatFatalStartupError(error);

    assert.equal(diagnostic.message.length, DESKTOP_FATAL_STARTUP_MESSAGE_MAX_LENGTH);
    assert.equal(diagnostic.detail.length, DESKTOP_FATAL_STARTUP_DETAIL_MAX_LENGTH);
    assert.isTrue(diagnostic.message.endsWith("…"));
    assert.isTrue(diagnostic.detail.endsWith("…"));
  });

  it("survives defects that throw while being stringified", () => {
    const diagnostic = formatFatalStartupError({
      toString() {
        throw new Error("coercion failed");
      },
    });

    assert.deepEqual(diagnostic, { message: "Unknown startup error.", detail: "" });
  });
});
