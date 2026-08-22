import { describe, expect, it } from "vite-plus/test";

import {
  connectionPhaseGroupPriority,
  environmentMachineKey,
  isWorkingConnectionPhase,
  selectVisibleRemoteEnvironmentIds,
} from "./environmentGrouping";

describe("environmentMachineKey", () => {
  it("normalizes case and whitespace so one machine groups together", () => {
    expect(environmentMachineKey("  Serge's  MacBook ")).toBe(
      environmentMachineKey("serge's macbook"),
    );
  });
});

describe("selectVisibleRemoteEnvironmentIds", () => {
  it("hides non-working duplicates once an entry for the machine is working", () => {
    const visible = selectVisibleRemoteEnvironmentIds([
      { id: "relay-online", machineKey: "mac", priority: 2, working: true },
      { id: "stale-offline", machineKey: "mac", priority: 3, working: false },
      { id: "broken", machineKey: "mac", priority: 4, working: false },
    ]);

    expect([...visible]).toEqual(["relay-online"]);
  });

  it("keeps every working entry for the same machine", () => {
    const visible = selectVisibleRemoteEnvironmentIds([
      { id: "connected", machineKey: "mac", priority: 0, working: true },
      { id: "also-online", machineKey: "mac", priority: 2, working: true },
      { id: "offline", machineKey: "mac", priority: 3, working: false },
    ]);

    expect(visible).toEqual(new Set(["connected", "also-online"]));
  });

  it("keeps a single representative when no entry for the machine is working", () => {
    const visible = selectVisibleRemoteEnvironmentIds([
      { id: "b-error", machineKey: "mac", priority: 4, working: false },
      { id: "a-offline", machineKey: "mac", priority: 3, working: false },
      { id: "c-offline", machineKey: "mac", priority: 3, working: false },
    ]);

    expect([...visible]).toEqual(["a-offline"]);
  });

  it("leaves entries for distinct machines untouched", () => {
    const visible = selectVisibleRemoteEnvironmentIds([
      { id: "mac", machineKey: "mac", priority: 0, working: true },
      { id: "linux-box", machineKey: "linux box", priority: 3, working: false },
    ]);

    expect(visible).toEqual(new Set(["mac", "linux-box"]));
  });
});

describe("connectionPhaseGroupPriority", () => {
  it("treats connected, connecting, and available phases as working", () => {
    expect(isWorkingConnectionPhase("connected")).toBe(true);
    expect(isWorkingConnectionPhase("reconnecting")).toBe(true);
    expect(isWorkingConnectionPhase("available")).toBe(true);
    expect(isWorkingConnectionPhase("offline")).toBe(false);
    expect(isWorkingConnectionPhase("error")).toBe(false);
  });

  it("orders healthier phases first", () => {
    expect(connectionPhaseGroupPriority("connected")).toBeLessThan(
      connectionPhaseGroupPriority("reconnecting"),
    );
    expect(connectionPhaseGroupPriority("reconnecting")).toBeLessThan(
      connectionPhaseGroupPriority("available"),
    );
    expect(connectionPhaseGroupPriority("available")).toBeLessThan(
      connectionPhaseGroupPriority("offline"),
    );
    expect(connectionPhaseGroupPriority("offline")).toBeLessThan(
      connectionPhaseGroupPriority("error"),
    );
  });
});
