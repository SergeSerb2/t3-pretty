import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  AgentMonitoringEnrollmentChoice,
  AgentMonitoringSettings as MonitoringSettings,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Exit from "effect/Exit";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import {
  agentMonitoringEnrollment,
  useAgentMonitoringEnrollment,
} from "../../state/agentMonitoring";
import { environmentPresentations, useEnvironmentPresentation } from "../../state/presentation";
import {
  persistedMobilePreferencesAtom,
  updateMobilePreferencesAtom,
} from "../../state/preferences";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsActionRow } from "./components/SettingsActionRow";
import { SettingsSection } from "./components/SettingsSection";

export function AgentMonitoringSettings({
  environmentId,
  allowed,
}: {
  environmentId: EnvironmentId;
  allowed: boolean;
}) {
  const { presentation } = useEnvironmentPresentation(environmentId);
  const stored = presentation?.serverConfig?.settings.agentMonitoring;
  const supported = presentation?.serverConfig?.observability.agentMonitoringSupported === true;
  const connected = presentation?.connection.phase === "connected";
  const preferences = useAtomValue(persistedMobilePreferencesAtom);
  const choice = AsyncResult.isSuccess(preferences)
    ? (preferences.value.agentMonitoringEnrollment ?? null)
    : null;
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const states = useAgentMonitoringEnrollment();
  const [draftDsn, setDsn] = useState<string | null>(null);
  const dsn = draftDsn ?? (stored?.sentryDsn || choice?.sentryDsn || "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const persist = useAtomSet(updateMobilePreferencesAtom, { mode: "promiseExit" });
  const { data, refresh } = useEnvironmentQuery(
    connected && supported
      ? serverEnvironment.agentMonitoringStatus({ environmentId, input: {} })
      : null,
  );
  useEffect(() => {
    if (states.get(environmentId) === "enrolled") refresh();
  }, [environmentId, refresh, states]);
  async function save(scope: "host" | "fleet" | "stop", enabled: boolean) {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const setting: MonitoringSettings = { enabled, sentryDsn: dsn.trim() };
      if (enabled && !setting.sentryDsn) throw new Error("Enter the Sentry ingestion DSN first.");
      const persistChoice = async (enrollment: AgentMonitoringEnrollmentChoice | null) => {
        const saved = await persist({ agentMonitoringEnrollment: enrollment });
        if (Exit.isFailure(saved)) throw new Error("Could not save enrollment on this device.");
      };
      if (scope === "host") {
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
          persistChoice,
        );
        refresh();
      } else {
        await persistChoice(scope === "fleet" ? setting : null);
      }
      setNotice(
        scope === "fleet"
          ? "Enrollment saved. Offline hosts will apply this choice when they connect to this device."
          : scope === "stop"
            ? "Automatic enrollment stopped on this device. Hosts keep their saved settings."
            : "Monitoring settings saved for every thread on this host. Automatic enrollment leaves this host's settings alone.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Monitoring settings were not saved.");
    } finally {
      setPending(false);
    }
  }
  return (
    <SettingsSection title="Agent monitoring">
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          Track all threads, tools, outcomes, durations, and grouped errors. Central monitoring
          receives metadata only. Prompts, arguments, paths, and raw results stay on the host.
        </Text>
        <Text className="text-sm font-t3-medium text-foreground">Sentry ingestion DSN</Text>
        <TextInput
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="none"
          maxLength={2048}
          value={dsn}
          onChangeText={setDsn}
          placeholder="https://…@…/project-id"
          accessibilityLabel="Sentry ingestion DSN"
          className="rounded-lg border border-border p-3 text-foreground"
        />
        <Text className="text-xs text-foreground-muted">
          Use the project DSN. Keep the management API token off your hosts.
        </Text>
        <Text className="text-sm text-foreground-muted">
          {!supported
            ? "Server update required"
            : !data
              ? "Checking monitoring"
              : data.state === "ready"
                ? data.lastExportAt
                  ? "Delivery confirmed"
                  : "Ready; awaiting activity"
                : data.state === "collecting"
                  ? "Collecting locally"
                  : data.state === "retrying"
                    ? "Retrying delivery"
                    : data.state === "disabled"
                      ? "Disabled"
                      : "Monitoring unavailable"}
          {data?.pendingCount != null ? ` · ${data.pendingCount} pending` : ""}
          {data?.droppedPendingCount ? ` · ${data.droppedPendingCount} dropped` : ""}
        </Text>
        {data?.monitoringEnvironmentId ? (
          <Text selectable className="text-xs text-foreground-muted">
            Monitoring ID: {data.monitoringEnvironmentId}
          </Text>
        ) : null}
        {data?.configurationSource === "environment" ? (
          <Text className="text-xs text-foreground-muted">
            A startup destination override applies; change it on the host and restart.
          </Text>
        ) : null}
        {data?.lastExportAt != null ? (
          <Text className="text-xs text-foreground-muted">
            Last delivery: {new Date(data.lastExportAt).toLocaleString()}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityRole="text" className="text-sm text-foreground-muted">
            {notice}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
        {choice !== null
          ? [...presentations].map(([id, host]) => (
              <Text key={id} className="text-xs text-foreground-muted">
                {host.entry.target.label}:{" "}
                {states.get(id) === "excluded"
                  ? "Using this host's settings"
                  : states.get(id) === "enrolled"
                    ? "Settings saved"
                    : states.get(id) === "failed"
                      ? "Could not save settings"
                      : states.get(id) === "pending"
                        ? "Saving settings"
                        : states.get(id) === "update-required"
                          ? "Server update required"
                          : "Waiting for connection"}
              </Text>
            ))
          : null}
      </View>
      <SettingsActionRow
        icon="checkmark.circle"
        label="Enable on this host"
        disabled={pending || !allowed || !supported || !dsn.trim()}
        onPress={() => void save("host", true)}
      />
      <SettingsActionRow
        icon="stop.fill"
        label="Disable on this host"
        disabled={pending || !allowed || !supported || !stored?.enabled}
        onPress={() => void save("host", false)}
      />
      <SettingsActionRow
        icon="checkmark.circle"
        label="Enable on all saved hosts"
        disabled={pending || !dsn.trim()}
        onPress={() => void save("fleet", true)}
      />
      <SettingsActionRow
        icon="stop.fill"
        label="Disable on all saved hosts"
        disabled={pending}
        onPress={() => void save("fleet", false)}
      />
      {choice !== null ? (
        <>
          <SettingsActionRow
            icon="stop.fill"
            label="Stop automatic enrollment on this device"
            disabled={pending}
            onPress={() => void save("stop", false)}
          />
          <SettingsActionRow
            icon="arrow.clockwise"
            label="Retry failed hosts"
            onPress={() => void agentMonitoringEnrollment.retryFailed()}
          />
        </>
      ) : null}
      <SettingsActionRow
        icon="arrow.clockwise"
        label="Refresh monitoring status"
        disabled={!supported || !connected}
        onPress={refresh}
      />
    </SettingsSection>
  );
}
