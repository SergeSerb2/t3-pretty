import { AgentMonitoringEnrollment } from "@t3tools/client-runtime/state/agent-monitoring-enrollment";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useSyncExternalStore } from "react";

import { useClientSettings } from "../hooks/useSettings";
import { useEnvironments } from "./environments";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

export const agentMonitoringEnrollment = new AgentMonitoringEnrollment();
export const useAgentMonitoringEnrollment = () =>
  useSyncExternalStore(agentMonitoringEnrollment.subscribe, agentMonitoringEnrollment.getSnapshot);

export function AgentMonitoringEnrollmentCoordinator() {
  const choice = useClientSettings((settings) => settings.agentMonitoringEnrollment);
  const { environments, isReady } = useEnvironments();
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  useEffect(() => {
    if (!isReady) return;
    void agentMonitoringEnrollment.reconcile(
      choice,
      environments.map((environment) => ({
        environmentId: environment.environmentId,
        connected:
          environment.connection.phase === "connected" && environment.serverConfig !== null,
        supported: environment.serverConfig?.observability.agentMonitoringSupported === true,
        settings: environment.serverConfig?.settings.agentMonitoring ?? null,
      })),
      async (environmentId, patch) => {
        const result = await update({ environmentId, input: { patch } });
        if (AsyncResult.isFailure(result)) throw new Error("Monitoring settings were not saved.");
      },
    );
  }, [choice, environments, isReady, update]);
  return null;
}
