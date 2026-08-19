import { describe, expect, it } from "@effect/vitest";

import {
  MOBILE_BACKGROUND_RECONNECT_AFTER_MS,
  mobileApplicationActiveWakeup,
} from "./app-state-wakeups";

describe("mobileApplicationActiveWakeup", () => {
  it("uses a fast probe after a short interruption", () => {
    expect(
      mobileApplicationActiveWakeup(20_000, 20_000 + MOBILE_BACKGROUND_RECONNECT_AFTER_MS - 1),
    ).toBe("application-active-probe");
  });

  it("also opens a replacement after a meaningful background suspension", () => {
    expect(
      mobileApplicationActiveWakeup(20_000, 20_000 + MOBILE_BACKGROUND_RECONNECT_AFTER_MS),
    ).toBe("application-active-reconnect");
  });
});
