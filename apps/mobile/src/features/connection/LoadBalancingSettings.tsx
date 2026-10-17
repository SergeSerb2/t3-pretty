import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  describeAgentPerf,
  LOAD_BALANCING_PREFERENCES,
  loadPreferenceForWeight,
} from "@t3tools/client-runtime/load-balancing";
import {
  AuthSettingsWriteScope,
  DEFAULT_LOAD_BALANCING_ENABLED,
  type EnvironmentId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState, type ComponentProps } from "react";
import { Alert, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useEnvironments } from "../../state/environments";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsChoiceRow } from "../settings/components/SettingsChoiceRow";

/** A machine row that adds its Agent Perf score to the preference label. */
function BenchmarkedRow({
  environmentId,
  value,
  ...props
}: ComponentProps<typeof SettingsRow> & { readonly environmentId: EnvironmentId }) {
  const result = useAtomValue(serverEnvironment.hostResources({ environmentId, input: {} }));
  const agentPerf = result._tag === "Success" ? result.value.agentPerf : undefined;
  const benchmark = agentPerf === undefined ? null : describeAgentPerf(agentPerf);
  return (
    <SettingsRow
      {...props}
      value={[value, benchmark?.label, benchmark?.error].filter(Boolean).join(" · ")}
    />
  );
}

export function LoadBalancingSettings() {
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const environments = connectedEnvironments.filter((environment) => environment.isEnabled);
  const { environments: presentations } = useEnvironments();
  const result = useAtomValue(mobilePreferencesAtom);
  const update = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const updateServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "Agent Perf benchmark setting",
    reportFailure: true,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (environments.length < 2) return null;
  const benchmarkMachines = presentations.filter(
    (presentation) =>
      presentation.connection.phase === "connected" &&
      presentation.serverConfig?.environment.capabilities.agentPerfBenchmark === true &&
      environments.some((environment) => environment.environmentId === presentation.environmentId),
  );
  const benchmarksOn = benchmarkMachines.some(
    (presentation) => presentation.serverConfig?.settings.agentPerfBenchmarks === true,
  );
  // A shared server setting, so it goes to every connected machine.
  const setBenchmarks = (agentPerfBenchmarks: boolean) => {
    for (const { environmentId } of benchmarkMachines) {
      if (!readEnvironmentScope(environmentId, AuthSettingsWriteScope)) continue;
      void updateServerSettings({ environmentId, input: { patch: { agentPerfBenchmarks } } });
    }
  };
  const hydrated = AsyncResult.isSuccess(result);
  const enabled = hydrated
    ? (result.value.loadBalancingEnabled ?? DEFAULT_LOAD_BALANCING_ENABLED)
    : false;
  const weights = hydrated ? (result.value.loadBalancingWeights ?? {}) : {};
  const disabled = !hydrated || saving;
  const save = async (patch: {
    loadBalancingEnabled?: boolean;
    loadBalancingWeights?: Record<string, number>;
  }) => {
    setSaving(true);
    try {
      await update(patch);
    } catch {
      Alert.alert("Could not save load preferences", "Try again before leaving this screen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="mt-5 gap-3">
      <SettingsSection title="Load balancing">
        <SettingsSwitchRow
          icon="arrow.triangle.branch"
          label="Automatically balance load"
          subtitle="Start new threads on the machine with the most free CPU and memory."
          value={enabled}
          disabled={disabled}
          onValueChange={(loadBalancingEnabled) => {
            void save({ loadBalancingEnabled });
          }}
        />
        {benchmarkMachines.length > 0 ? (
          <SettingsSwitchRow
            icon="chart.bar.xaxis"
            label="Benchmark machines weekly"
            subtitle="Each machine runs Agent Perf for a few minutes about once a week, only while it is idle, and stops when an agent starts. Needs Python 3.8 or newer."
            value={benchmarksOn}
            disabled={!benchmarksOn && !enabled}
            onValueChange={setBenchmarks}
          />
        ) : null}
        {environments.map((environment) => {
          const preference = loadPreferenceForWeight(weights[environment.environmentId]);
          const row = {
            icon: "desktopcomputer",
            label: environment.environmentLabel,
            value: LOAD_BALANCING_PREFERENCES.find((option) => option.value === preference)?.label,
            disabled: disabled || !enabled,
            onPress: () =>
              setExpandedId(
                expandedId === environment.environmentId ? null : environment.environmentId,
              ),
          } satisfies ComponentProps<typeof SettingsRow>;
          const benchmarked =
            benchmarksOn &&
            benchmarkMachines.some(
              (presentation) => presentation.environmentId === environment.environmentId,
            );
          return (
            <View key={environment.environmentId}>
              {benchmarked ? (
                <BenchmarkedRow {...row} environmentId={environment.environmentId} />
              ) : (
                <SettingsRow {...row} />
              )}
              {expandedId === environment.environmentId
                ? LOAD_BALANCING_PREFERENCES.map((option) => (
                    <SettingsChoiceRow
                      key={option.value}
                      label={option.label}
                      description={option.description}
                      selected={preference === option.value}
                      separated
                      disabled={disabled || !enabled}
                      onPress={() => {
                        void save({
                          loadBalancingWeights: {
                            ...weights,
                            [environment.environmentId]: option.value,
                          },
                        });
                      }}
                    />
                  ))
                : null}
            </View>
          );
        })}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        Applies to new threads in shared projects. Choose a machine in the composer to override it.
        Preferences are saved on this device.
        {benchmarkMachines.length > 0 ? " Benchmark scores make faster machines more likely." : ""}
      </Text>
    </View>
  );
}
