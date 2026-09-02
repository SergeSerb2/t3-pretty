import { describe, expect, it } from "vite-plus/test";

import { isProjectTransferThreadBusy } from "./projectTransfer.ts";

describe("projectTransfer helpers", () => {
  it("treats running turns, sessions, and pending prompts as busy", () => {
    expect(isProjectTransferThreadBusy({ latestTurn: { state: "running" } })).toBe(true);
    expect(isProjectTransferThreadBusy({ session: { status: "starting" } })).toBe(true);
    expect(isProjectTransferThreadBusy({ hasPendingApprovals: true })).toBe(true);
    expect(isProjectTransferThreadBusy({ hasPendingUserInput: true })).toBe(true);
    expect(isProjectTransferThreadBusy({ latestTurn: { state: "complete" } })).toBe(false);
  });
});
