import { describe, expect, it } from "vite-plus/test";

import { isProjectTransferThreadBusy, projectTransferSourceRemains } from "./projectTransfer.ts";

describe("projectTransfer helpers", () => {
  it("treats running turns, sessions, and pending prompts as busy", () => {
    expect(isProjectTransferThreadBusy({ latestTurn: { state: "running" } })).toBe(true);
    expect(isProjectTransferThreadBusy({ session: { status: "starting" } })).toBe(true);
    expect(isProjectTransferThreadBusy({ hasPendingApprovals: true })).toBe(true);
    expect(isProjectTransferThreadBusy({ hasPendingUserInput: true })).toBe(true);
    expect(isProjectTransferThreadBusy({ latestTurn: { state: "complete" } })).toBe(false);
  });

  it("treats a move as incomplete unless sourceRemoved is true", () => {
    expect(projectTransferSourceRemains("move", true)).toBe(false);
    expect(projectTransferSourceRemains("move", false)).toBe(true);
    expect(projectTransferSourceRemains("move", undefined)).toBe(true);
    expect(projectTransferSourceRemains("copy", undefined)).toBe(false);
    expect(projectTransferSourceRemains("copy", false)).toBe(false);
  });
});
