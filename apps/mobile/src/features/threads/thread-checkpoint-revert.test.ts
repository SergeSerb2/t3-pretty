import { describe, expect, it } from "vite-plus/test";

import {
  checkpointEnvironmentAvailable,
  checkpointRevertBlockReason,
  checkpointRevertConfirmation,
} from "./thread-checkpoint-revert";

describe("checkpointEnvironmentAvailable", () => {
  it("treats a missing remote runtime as available (local/on-device)", () => {
    expect(checkpointEnvironmentAvailable(null)).toBe(true);
  });

  it("allows a connected remote", () => {
    expect(checkpointEnvironmentAvailable("connected")).toBe(true);
  });

  it("blocks remotes that are not connected", () => {
    expect(checkpointEnvironmentAvailable("available")).toBe(false);
    expect(checkpointEnvironmentAvailable("offline")).toBe(false);
    expect(checkpointEnvironmentAvailable("connecting")).toBe(false);
    expect(checkpointEnvironmentAvailable("reconnecting")).toBe(false);
    expect(checkpointEnvironmentAvailable("error")).toBe(false);
  });
});

describe("checkpointRevertBlockReason", () => {
  it("allows the revert when the environment is connected and no turn is running", () => {
    expect(
      checkpointRevertBlockReason({
        environmentAvailable: true,
        environmentLabel: "Workstation",
        sessionRunning: false,
      }),
    ).toBeNull();
  });

  it("blocks while the environment is unavailable, naming it when known", () => {
    expect(
      checkpointRevertBlockReason({
        environmentAvailable: false,
        environmentLabel: "Workstation",
        sessionRunning: false,
      }),
    ).toBe("Reconnect Workstation before reverting checkpoints.");
    expect(
      checkpointRevertBlockReason({
        environmentAvailable: false,
        environmentLabel: null,
        sessionRunning: false,
      }),
    ).toBe("Reconnect the environment before reverting checkpoints.");
  });

  it("blocks while a turn is running", () => {
    expect(
      checkpointRevertBlockReason({
        environmentAvailable: true,
        environmentLabel: "Workstation",
        sessionRunning: true,
      }),
    ).toBe("Interrupt the current turn before reverting checkpoints.");
  });

  it("reports the environment before the running turn, matching web's order", () => {
    expect(
      checkpointRevertBlockReason({
        environmentAvailable: false,
        environmentLabel: "Workstation",
        sessionRunning: true,
      }),
    ).toBe("Reconnect Workstation before reverting checkpoints.");
  });
});

describe("checkpointRevertConfirmation", () => {
  it("keeps web's destructive-confirm wording", () => {
    expect(checkpointRevertConfirmation(3)).toEqual({
      title: "Revert this thread to checkpoint 3?",
      message:
        "This will discard newer messages and turn diffs in this thread. This action cannot be undone.",
    });
  });
});
