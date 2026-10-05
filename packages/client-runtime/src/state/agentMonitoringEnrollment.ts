import type {
  AgentMonitoringSettings,
  EnvironmentId,
  ServerSettingsPatch,
} from "@t3tools/contracts";

export interface AgentMonitoringEnrollmentTarget {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly supported: boolean;
  readonly settings: AgentMonitoringSettings | null;
}

type EnrollmentState = "waiting" | "update-required" | "pending" | "enrolled" | "failed";

/** Applies a persisted fleet choice when hosts become reachable, with one ordered write per host. */
export class AgentMonitoringEnrollment {
  private choiceKey: string | null = null;
  private choice: AgentMonitoringSettings | null = null;
  private write:
    | ((environmentId: EnvironmentId, patch: ServerSettingsPatch) => Promise<void>)
    | undefined;
  private targets = new Map<EnvironmentId, AgentMonitoringEnrollmentTarget>();
  private attempts = new Map<EnvironmentId, string>();
  private pending = new Map<EnvironmentId, { key: string; promise: Promise<void> }>();
  private states: ReadonlyMap<EnvironmentId, EnrollmentState> = new Map();
  private listeners = new Set<() => void>();

  readonly getSnapshot = () => this.states;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(environmentId: EnvironmentId, state: EnrollmentState) {
    if (this.states.get(environmentId) === state) return;
    this.states = new Map(this.states).set(environmentId, state);
    for (const listener of this.listeners) listener();
  }

  async waitForPending(environmentId: EnvironmentId) {
    await this.pending.get(environmentId)?.promise;
  }

  async retryFailed() {
    for (const [environmentId, state] of this.states) {
      if (state !== "failed") continue;
      this.attempts.delete(environmentId);
      this.set(environmentId, "pending");
    }
    if (this.write) await this.reconcile(this.choice, [...this.targets.values()], this.write);
  }

  async reconcile(
    choice: AgentMonitoringSettings | null,
    targets: ReadonlyArray<AgentMonitoringEnrollmentTarget>,
    write: (environmentId: EnvironmentId, patch: ServerSettingsPatch) => Promise<void>,
  ): Promise<void> {
    const key = choice === null ? null : `${choice.enabled}:${choice.sentryDsn}`;
    this.choice = choice;
    this.write = write;
    this.choiceKey = key;
    this.targets = new Map(targets.map((target) => [target.environmentId, target]));
    if (choice === null || key === null) {
      if (this.states.size > 0) {
        this.states = new Map();
        for (const listener of this.listeners) listener();
      }
      this.attempts.clear();
      return;
    }
    const tasks: Promise<void>[] = [];
    for (const target of targets) {
      const id = target.environmentId;
      if (!target.connected) {
        this.attempts.delete(id);
        this.set(id, "waiting");
        continue;
      }
      if (!target.supported) {
        this.set(id, "update-required");
        continue;
      }
      if (choice.enabled && choice.sentryDsn.trim().length === 0) {
        this.set(id, "failed");
        continue;
      }
      const pending = this.pending.get(id);
      if (pending?.key === key) continue;
      if (this.attempts.get(id) === key && this.states.get(id) === "failed") continue;
      const matches =
        target.settings?.enabled === choice.enabled &&
        (!choice.enabled || target.settings.sentryDsn === choice.sentryDsn);
      if (matches && pending === undefined) {
        this.set(id, "enrolled");
        continue;
      }
      if (this.attempts.get(id) === key) continue;
      this.attempts.set(id, key);
      this.set(id, "pending");
      let outcome: "enrolled" | "failed" | undefined;
      const promise = (pending?.promise ?? Promise.resolve())
        .then(async () => {
          if (this.choiceKey !== key || this.targets.get(id)?.connected !== true) return;
          try {
            await write(id, { agentMonitoring: choice.enabled ? choice : { enabled: false } });
            outcome = "enrolled";
          } catch {
            outcome = "failed";
          }
        })
        .finally(() => {
          if (this.pending.get(id)?.promise !== promise) return;
          this.pending.delete(id);
          if (outcome && this.choiceKey === key && this.targets.get(id)?.connected === true)
            this.set(id, outcome);
        });
      this.pending.set(id, { key, promise });
      tasks.push(promise);
    }
    await Promise.all(tasks);
  }
}
