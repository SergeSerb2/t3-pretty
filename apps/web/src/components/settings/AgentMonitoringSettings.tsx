import type {
  AgentMonitoringSettings as MonitoringSettings,
  EnvironmentId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useState } from "react";

import { persistClientSettingsUpdate, useClientSettings } from "../../hooks/useSettings";
import {
  agentMonitoringEnrollment,
  useAgentMonitoringEnrollment,
} from "../../state/agentMonitoring";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

const labels = {
  waiting: "Waiting for connection",
  "update-required": "Server update required",
  pending: "Saving settings",
  enrolled: "Settings saved",
  failed: "Could not save settings",
};

function MonitoringHostStatus({
  environment,
  savedRevision,
}: {
  environment: EnvironmentPresentation;
  savedRevision: number;
}) {
  const enrollment = useAgentMonitoringEnrollment().get(environment.environmentId);
  const connected = environment.connection.phase === "connected";
  const supported = environment.serverConfig?.observability.agentMonitoringSupported === true;
  const { data, refresh, isPending } = useEnvironmentQuery(
    connected && supported
      ? serverEnvironment.agentMonitoringStatus({
          environmentId: environment.environmentId,
          input: {},
        })
      : null,
  );
  // Refresh after an acknowledged enrollment or a host settings change.
  // oxlint-disable react/exhaustive-effect-dependencies -- Settings and save receipts trigger a status refresh.
  useEffect(() => {
    if (connected && supported) refresh();
  }, [
    connected,
    supported,
    enrollment,
    environment.serverConfig?.settings.agentMonitoring.enabled,
    environment.serverConfig?.settings.agentMonitoring.sentryDsn,
    savedRevision,
    refresh,
  ]);
  // oxlint-enable react/exhaustive-effect-dependencies
  const status = !connected
    ? "Waiting for connection"
    : !supported
      ? "Server update required"
      : enrollment === "pending" || enrollment === "failed"
        ? labels[enrollment]
        : data === null
          ? "Checking monitoring"
          : data.state === "disabled"
            ? "Disabled"
            : data.state === "unavailable"
              ? "Monitoring unavailable"
              : data.state === "collecting"
                ? "Collecting locally"
                : data.state === "retrying"
                  ? "Retrying delivery"
                  : data.lastExportAt === null
                    ? "Ready; awaiting activity"
                    : "Delivery confirmed";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 py-3">
      <div>
        <div className="text-sm font-medium">{environment.label}</div>
        <div className="text-xs text-muted-foreground">
          {status}
          {data?.pendingCount != null ? ` · ${data.pendingCount} pending` : ""}
          {data?.droppedPendingCount ? ` · ${data.droppedPendingCount} dropped` : ""}
        </div>
        {data?.lastExportAt != null ? (
          <div className="text-xs text-muted-foreground">
            Last delivery: {new Date(data.lastExportAt).toLocaleString()}
          </div>
        ) : null}
        {data?.monitoringEnvironmentId ? (
          <div className="break-all text-xs text-muted-foreground">
            Monitoring ID: <span className="font-mono">{data.monitoringEnvironmentId}</span>
          </div>
        ) : null}
        {data?.configurationSource === "environment" ? (
          <div className="text-xs text-muted-foreground">
            Startup overrides apply; changes to those require a host restart.
          </div>
        ) : null}
      </div>
      {connected && supported ? (
        <Button variant="ghost" size="sm" disabled={isPending} onClick={refresh}>
          Refresh
        </Button>
      ) : null}
    </div>
  );
}

export function AgentMonitoringSettings() {
  const { environment } = useSettingsScope();
  return (
    <AgentMonitoringSettingsForm
      key={environment?.environmentId ?? "none"}
      environmentId={environment?.environmentId ?? null}
    />
  );
}

function AgentMonitoringSettingsForm({ environmentId }: { environmentId: EnvironmentId | null }) {
  const { environments } = useEnvironments();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const stored = environment?.serverConfig?.settings.agentMonitoring;
  const supported = environment?.serverConfig?.observability.agentMonitoringSupported === true;
  const choice = useClientSettings((settings) => settings.agentMonitoringEnrollment);
  const [draftDsn, setDsn] = useState<string | null>(null);
  const dsn = draftDsn ?? (stored?.sentryDsn || choice?.sentryDsn || "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedRevision, setSavedRevision] = useState(0);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  async function save(scope: "host" | "fleet" | "stop", enabled: boolean) {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const setting: MonitoringSettings = { enabled, sentryDsn: dsn.trim() };
      if (enabled && setting.sentryDsn.length === 0)
        throw new Error("Enter the Sentry ingestion DSN first.");
      const persistChoice = (enrollment: MonitoringSettings | null) =>
        persistClientSettingsUpdate((current) => ({
          ...current,
          agentMonitoringEnrollment: enrollment,
        }));
      if (scope === "host" && environmentId !== null) {
        await agentMonitoringEnrollment.saveHost(
          environmentId,
          async () => {
            const result = await update({
              environmentId,
              input: { patch: { agentMonitoring: enabled ? setting : { enabled: false } } },
            });
            if (AsyncResult.isFailure(result))
              throw new Error(
                "This host could not save monitoring settings. Check your connection and permissions.",
              );
          },
          async () => {
            await persistChoice(null);
          },
        );
        setSavedRevision((revision) => revision + 1);
      } else {
        await persistChoice(scope === "fleet" ? setting : null);
      }
      setNotice(
        scope === "fleet"
          ? "Enrollment saved. Offline hosts will apply this choice when they connect to this device."
          : scope === "stop"
            ? "Automatic enrollment stopped on this device. Hosts keep their saved settings."
            : "Monitoring settings saved for every thread on this host.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Monitoring settings were not saved.");
    } finally {
      setPending(false);
    }
  }
  return (
    <SettingsSection id="agent-monitoring" title="Agent monitoring">
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <p className="text-sm text-muted-foreground">
          Automatically track agents, tools, outcomes, durations, and grouped errors for every
          thread on enabled hosts. Central monitoring receives metadata only; prompts, tool
          arguments, file paths, and raw results stay on the host.
        </p>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Sentry ingestion DSN</span>
          <Input
            type="password"
            autoComplete="off"
            maxLength={2048}
            value={dsn}
            onChange={(event) => setDsn(event.target.value)}
            placeholder="https://…@…/project-id"
            aria-label="Sentry ingestion DSN"
          />
          <span className="block text-xs text-muted-foreground">
            Use the project DSN. The Sentry management API token is not needed on your machines.
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending || !supported || !dsn.trim()}
            onClick={() => void save("host", true)}
          >
            Enable on this host
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !supported || !stored?.enabled}
            onClick={() => void save("host", false)}
          >
            Disable on this host
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !dsn.trim()}
            onClick={() => void save("fleet", true)}
          >
            Enable on all saved hosts
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void save("fleet", false)}
          >
            Disable on all saved hosts
          </Button>
        </div>
        {choice !== null ? (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              Automatic enrollment from this device is{" "}
              {choice.enabled ? "enabled" : "disabling monitoring"}.
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => void save("stop", false)}
            >
              Stop automatic enrollment
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void agentMonitoringEnrollment.retryFailed()}
            >
              Retry failed hosts
            </Button>
          </div>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div>
          {environments.map((entry) => (
            <MonitoringHostStatus
              key={entry.environmentId}
              environment={entry}
              savedRevision={entry.environmentId === environmentId ? savedRevision : 0}
            />
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}
