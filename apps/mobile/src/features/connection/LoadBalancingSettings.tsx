import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  LOAD_BALANCING_PREFERENCES,
  loadPreferenceForWeight,
} from "@t3tools/client-runtime/load-balancing";
import { DEFAULT_LOAD_BALANCING_ENABLED } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Alert, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsChoiceRow } from "../settings/components/SettingsChoiceRow";

export function LoadBalancingSettings() {
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const environments = connectedEnvironments.filter((environment) => environment.isEnabled);
  const result = useAtomValue(mobilePreferencesAtom);
  const update = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (environments.length < 2) return null;
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
        {environments.map((environment) => {
          const preference = loadPreferenceForWeight(weights[environment.environmentId]);
          return (
            <View key={environment.environmentId}>
              <SettingsRow
                icon="desktopcomputer"
                label={environment.environmentLabel}
                value={
                  LOAD_BALANCING_PREFERENCES.find((option) => option.value === preference)?.label
                }
                disabled={disabled || !enabled}
                onPress={() =>
                  setExpandedId(
                    expandedId === environment.environmentId ? null : environment.environmentId,
                  )
                }
              />
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
      </Text>
    </View>
  );
}
