import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type AgentMonitoringSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  AgentMonitoringEnrollment,
  type AgentMonitoringEnrollmentTarget,
} from "./agentMonitoringEnrollment.ts";

const id = EnvironmentId.make("laptop");
const choice: AgentMonitoringSettings = {
  enabled: true,
  sentryDsn: "https://public@example.com/1",
};
const target = (
  overrides: Partial<AgentMonitoringEnrollmentTarget> = {},
): AgentMonitoringEnrollmentTarget => ({
  environmentId: id,
  connected: true,
  supported: true,
  settings: { enabled: false, sentryDsn: "" },
  ...overrides,
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("automatic agent monitoring enrollment", () => {
  it("enrolls offline hosts when they reconnect and leaves older servers pending an update", async () => {
    const enrollment = new AgentMonitoringEnrollment();
    const writes: ServerSettingsPatch[] = [];
    const write = async (_id: EnvironmentId, patch: ServerSettingsPatch) => {
      writes.push(patch);
    };
    await enrollment.reconcile(choice, [target({ connected: false })], write);
    expect(enrollment.getSnapshot().get(id)).toBe("waiting");
    await enrollment.reconcile(choice, [target({ supported: false })], write);
    expect(enrollment.getSnapshot().get(id)).toBe("update-required");
    expect(writes).toEqual([]);
    await enrollment.reconcile(choice, [target()], write);
    expect(writes).toEqual([{ agentMonitoring: choice }]);
    expect(enrollment.getSnapshot().get(id)).toBe("enrolled");
    await enrollment.reconcile(choice, [target({ settings: choice })], write);
    expect(writes).toHaveLength(1);
  });

  it("waits for the server receipt even when its configuration is optimistic", async () => {
    const enrollment = new AgentMonitoringEnrollment();
    const receipt = deferred();
    const saving = enrollment.reconcile(choice, [target()], () => receipt.promise);
    await enrollment.reconcile(choice, [target({ settings: choice })], () => receipt.promise);
    expect(enrollment.getSnapshot().get(id)).toBe("pending");
    receipt.resolve();
    await saving;
    expect(enrollment.getSnapshot().get(id)).toBe("enrolled");
  });

  it("retains failures without a retry loop and retries on request or reconnect", async () => {
    const enrollment = new AgentMonitoringEnrollment();
    let calls = 0;
    const fail = async () => {
      calls++;
      throw new Error("denied");
    };
    await enrollment.reconcile(choice, [target()], fail);
    await enrollment.reconcile(choice, [target({ settings: choice })], fail);
    expect(calls).toBe(1);
    expect(enrollment.getSnapshot().get(id)).toBe("failed");
    await enrollment.retryFailed();
    await enrollment.reconcile(choice, [target()], fail);
    expect(calls).toBe(2);
    await enrollment.reconcile(choice, [target({ connected: false })], fail);
    await enrollment.reconcile(choice, [target()], async () => {
      calls++;
    });
    expect(calls).toBe(3);
    expect(enrollment.getSnapshot().get(id)).toBe("enrolled");
  });

  it("serializes rapid changes so disabling wins over an in-flight enable", async () => {
    const enrollment = new AgentMonitoringEnrollment();
    const started = deferred();
    const receipt = deferred();
    const writes: ServerSettingsPatch[] = [];
    const write = async (_id: EnvironmentId, patch: ServerSettingsPatch) => {
      writes.push(patch);
      if (writes.length === 1) {
        started.resolve();
        await receipt.promise;
      }
    };
    const enabling = enrollment.reconcile(choice, [target()], write);
    await started.promise;
    const disabling = enrollment.reconcile(
      { ...choice, enabled: false },
      [target({ settings: choice })],
      write,
    );
    expect(writes).toHaveLength(1);
    receipt.resolve();
    await Promise.all([enabling, disabling]);
    expect(writes).toEqual([{ agentMonitoring: choice }, { agentMonitoring: { enabled: false } }]);
    expect(enrollment.getSnapshot().get(id)).toBe("enrolled");
  });

  it("stops queued enrollment when the saved intent is removed", async () => {
    const enrollment = new AgentMonitoringEnrollment();
    const writes: ServerSettingsPatch[] = [];
    const saving = enrollment.reconcile(choice, [target()], async (_id, patch) => {
      writes.push(patch);
    });
    await enrollment.reconcile(null, [target()], async () => {});
    await saving;
    expect(writes).toEqual([]);
    expect(enrollment.getSnapshot().size).toBe(0);
  });

  it("preserves fleet intent after a failed host save and drains older writes before a successful edit", async () => {
    const enrollment = new AgentMonitoringEnrollment();
    const writes: ServerSettingsPatch[] = [];
    const write = async (_id: EnvironmentId, patch: ServerSettingsPatch) => {
      writes.push(patch);
    };
    let persisted: AgentMonitoringSettings | null = choice;
    await enrollment.reconcile(choice, [target({ settings: choice })], write);
    await expect(
      enrollment.saveHost(
        id,
        async () => {
          throw new Error("denied");
        },
        async () => {
          persisted = null;
        },
      ),
    ).rejects.toThrow("denied");
    expect(persisted).toEqual(choice);
    await enrollment.reconcile(choice, [target({ connected: false })], write);
    await enrollment.reconcile(choice, [target()], write);
    expect(writes).toEqual([{ agentMonitoring: choice }]);

    const started = deferred();
    const receipt = deferred();
    await enrollment.reconcile(choice, [target({ connected: false })], write);
    const enrolling = enrollment.reconcile(choice, [target()], async (_id, patch) => {
      writes.push(patch);
      started.resolve();
      await receipt.promise;
    });
    await started.promise;
    const editing = enrollment.saveHost(
      id,
      async () => {
        expect(persisted).toEqual(choice);
        writes.push({ agentMonitoring: { enabled: false } });
      },
      async () => {
        persisted = null;
      },
    );
    await enrollment.reconcile(choice, [target()], write);
    expect(writes).toHaveLength(2);
    receipt.resolve();
    await Promise.all([enrolling, editing]);
    expect(writes.at(-1)).toEqual({ agentMonitoring: { enabled: false } });
    expect(persisted).toBeNull();
    expect(enrollment.getSnapshot().size).toBe(0);
  });
});
