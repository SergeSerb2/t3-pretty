import type {
  AgentMonitoringEnrollmentChoice,
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

type EnrollmentState =
  | "waiting"
  | "update-required"
  | "pending"
  | "enrolled"
  | "failed"
  | "excluded";

/** Applies a persisted fleet choice when hosts become reachable, with one ordered write per host. */
export class AgentMonitoringEnrollment {
  private choiceKey: string | null = null;
  private choice: AgentMonitoringEnrollmentChoice | null = null;
  private write:
    | ((environmentId: EnvironmentId, patch: ServerSettingsPatch) => Promise<void>)
    | undefined;
  private targets = new Map<EnvironmentId, AgentMonitoringEnrollmentTarget>();
  private attempts = new Map<EnvironmentId, string>();
  private pending = new Map<EnvironmentId, { key: string; promise: Promise<void> }>();
  private states: ReadonlyMap<EnvironmentId, EnrollmentState> = new Map();
  private listeners = new Set<() => void>();
  private hostSaves = new Set<EnvironmentId>();

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

  /** Persist a host exception before editing it so reconnects cannot undo the host's choice. */
  async saveHost(
    environmentId: EnvironmentId,
    save: () => Promise<void>,
    persistChoice: (choice: AgentMonitoringEnrollmentChoice) => Promise<void>,
  ) {
    this.hostSaves.add(environmentId);
    try {
      await this.waitForPending(environmentId);
      const previous = this.choice;
      if (previous !== null) {
        const next = {
          ...previous,
          excludedEnvironmentIds: [
            ...new Set([...(previous.excludedEnvironmentIds ?? []), environmentId]),
          ],
        };
        await persistChoice(next);
        if (this.write) void this.reconcile(next, [...this.targets.values()], this.write);
      }
      try {
        await save();
      } catch (cause) {
        if (previous !== null) {
          await persistChoice(previous);
          if (this.write) void this.reconcile(previous, [...this.targets.values()], this.write);
        }
        throw cause;
      }
    } finally {
      this.hostSaves.delete(environmentId);
      if (this.write) void this.reconcile(this.choice, [...this.targets.values()], this.write);
    }
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
    choice: AgentMonitoringEnrollmentChoice | null,
    targets: ReadonlyArray<AgentMonitoringEnrollmentTarget>,
    write: (environmentId: EnvironmentId, patch: ServerSettingsPatch) => Promise<void>,
  ): Promise<void> {
    const key =
      choice === null
        ? null
        : `${choice.enabled}:${choice.sentryDsn}:${JSON.stringify(choice.excludedEnvironmentIds ?? [])}`;
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
    const excluded = new Set(choice.excludedEnvironmentIds ?? []);
    for (const target of targets) {
      const id = target.environmentId;
      if (this.hostSaves.has(id)) continue;
      if (excluded.has(id)) {
        this.set(id, "excluded");
        continue;
      }
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
          if (
            this.choiceKey !== key ||
            this.targets.get(id)?.connected !== true ||
            this.hostSaves.has(id) ||
            this.choice?.excludedEnvironmentIds?.includes(id)
          )
            return;
          try {
            await write(id, {
              agentMonitoring: choice.enabled
                ? { enabled: true, sentryDsn: choice.sentryDsn }
                : { enabled: false },
            });
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
