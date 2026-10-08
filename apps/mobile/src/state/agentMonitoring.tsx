import { useAtomValue } from "@effect/atom-react";
import { AgentMonitoringEnrollment } from "@t3tools/client-runtime/state/agent-monitoring-enrollment";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useSyncExternalStore } from "react";

import { environmentPresentations } from "./presentation";
import { persistedMobilePreferencesAtom } from "./preferences";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

export const agentMonitoringEnrollment = new AgentMonitoringEnrollment();
export const useAgentMonitoringEnrollment = () =>
  useSyncExternalStore(agentMonitoringEnrollment.subscribe, agentMonitoringEnrollment.getSnapshot);

export function AgentMonitoringEnrollmentCoordinator() {
  const preferences = useAtomValue(persistedMobilePreferencesAtom);
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const choice = AsyncResult.isSuccess(preferences)
    ? (preferences.value.agentMonitoringEnrollment ?? null)
    : null;
  useEffect(() => {
    if (!AsyncResult.isSuccess(preferences)) return;
    void agentMonitoringEnrollment.reconcile(
      choice,
      [...presentations].map(([environmentId, environment]) => ({
        environmentId,
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
  }, [choice, preferences, presentations, update]);
  return null;
}
