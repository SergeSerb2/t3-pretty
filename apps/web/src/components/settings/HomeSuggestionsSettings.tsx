import { useNavigate } from "@tanstack/react-router";
import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  HOME_SUGGESTIONS_TIME_PATTERN,
  ProviderDriverKind as ProviderDriverKindSchema,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Equal from "effect/Equal";
import { useCallback, useState } from "react";

import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { homeSuggestionsEnvironment } from "../../state/homeSuggestions";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { RefreshIcon } from "../ui/refresh-icon";
import { toastManager } from "../ui/toast";
import { ScopedSwitch } from "./ScopedSwitch";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const DEFAULT_DRIVER_KIND = ProviderDriverKindSchema.make("codex");

function describeCommandFailure(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
}

/**
 * Settings → General → Home suggestions: the daily toggle, the (stronger)
 * model that plans the cards, the local time the batch regenerates, and a
 * button to generate a batch right now.
 */
export function HomeSuggestionsSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environment, connectedEnvironments } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const serverProviders = environment?.serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  const refresh = useAtomCommand(homeSuggestionsEnvironment.refresh, { reportFailure: false });
  const [generating, setGenerating] = useState(false);

  const textGenerationProviders = serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  // The picker helpers read `textGenerationModelSelection`; feed them ours.
  const selection = resolveAppModelSelectionState(
    { ...settings, textGenerationModelSelection: settings.homeSuggestionsModelSelection },
    textGenerationProviders,
  );
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(textGenerationProviders), settings),
  );
  const hasProvider = instanceEntries.some((entry) => entry.enabled && entry.isAvailable);
  const instanceEntry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
  const provider: ProviderDriverKind = instanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textGenerationProviders,
    selection.instanceId,
    selection.model,
  );
  const modelDisabledReason = useScopedModelDisabledReason(settings, instanceEntries);
  const mixedModel = useScopedSettingsMixed(["homeSuggestionsModelSelection"]);
  const isModelDirty = !Equal.equals(
    settings.homeSuggestionsModelSelection,
    DEFAULT_UNIFIED_SETTINGS.homeSuggestionsModelSelection,
  );
  const isTimeDirty = settings.homeSuggestionsTime !== DEFAULT_UNIFIED_SETTINGS.homeSuggestionsTime;

  const generateNow = useCallback(async () => {
    if (environmentId === null) return;
    setGenerating(true);
    const outcome = await refresh({ environmentId, input: {} });
    setGenerating(false);
    if (outcome._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not generate suggestions",
        description: describeCommandFailure(outcome),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: "Generating suggestions",
      description: "The new cards will appear on the home screen in a minute or two.",
    });
  }, [environmentId, refresh]);

  return (
    <SettingsSection id="home-suggestions" title="Home suggestions">
      <SettingsRow
        serverScoped
        settingKeys={["homeSuggestionsEnabled"]}
        {...searchableSetting("home-suggestions-enabled")}
        description="Once a day, read your projects and recent threads and propose prompt cards on the home screen."
        resetAction={
          settings.homeSuggestionsEnabled !== DEFAULT_UNIFIED_SETTINGS.homeSuggestionsEnabled ? (
            <SettingResetButton
              label="home suggestions"
              onClick={() =>
                updateSettings({
                  homeSuggestionsEnabled: DEFAULT_UNIFIED_SETTINGS.homeSuggestionsEnabled,
                })
              }
            />
          ) : null
        }
        control={
          <ScopedSwitch
            settingKeys={["homeSuggestionsEnabled"]}
            checked={settings.homeSuggestionsEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ homeSuggestionsEnabled: Boolean(checked) })
            }
            aria-label="Daily home suggestions"
          />
        }
      />

      <SettingsRow
        serverScoped
        settingKeys={["homeSuggestionsModelSelection"]}
        {...searchableSetting("home-suggestions-model")}
        description="Reads a digest of every recent thread and plans the cards, so it defaults to a stronger model than other generated text."
        resetAction={
          hasServerTargets && isModelDirty ? (
            <SettingResetButton
              label="home suggestions model"
              onClick={() =>
                updateSettings({
                  homeSuggestionsModelSelection:
                    DEFAULT_UNIFIED_SETTINGS.homeSuggestionsModelSelection,
                })
              }
            />
          ) : null
        }
        control={
          !hasServerTargets ? (
            <span className="text-sm text-muted-foreground">
              Connect an environment to choose its suggestion model.
            </span>
          ) : !hasProvider ? (
            <span className="text-sm text-muted-foreground">
              No text generation providers available.
            </span>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                triggerAriaLabel="Home suggestions model"
                {...(mixedModel ? { triggerLabel: "Mixed" } : {})}
                getModelDisabledReason={modelDisabledReason}
                {...(environmentId
                  ? {
                      onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                        void navigate({
                          to: "/settings/providers",
                          search: { environmentId, instanceId },
                        });
                      },
                    }
                  : {})}
                onInstanceModelChange={(instanceId, model) => {
                  const reason = modelDisabledReason(instanceId, model);
                  if (reason) {
                    toastManager.add({
                      type: "error",
                      title: "Home suggestions model not saved",
                      description: reason,
                    });
                    return;
                  }
                  updateSettings({
                    homeSuggestionsModelSelection: createModelSelection(instanceId, model),
                  });
                }}
              />
              {instanceEntry ? (
                <TraitsPicker
                  provider={provider}
                  models={instanceEntry.models ?? []}
                  model={selection.model}
                  prompt=""
                  onPromptChange={() => {}}
                  modelOptions={selection.options}
                  allowPromptInjectedEffort={false}
                  planModeEnabled={settings.planModeEnabled}
                  triggerVariant="outline"
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  onModelOptionsChange={(nextOptions) => {
                    updateSettings({
                      homeSuggestionsModelSelection: createModelSelection(
                        selection.instanceId,
                        selection.model,
                        nextOptions,
                      ),
                    });
                  }}
                />
              ) : null}
            </div>
          )
        }
      />

      <SettingsRow
        serverScoped
        settingKeys={["homeSuggestionsTime"]}
        {...searchableSetting("home-suggestions-time")}
        description="Local time on the environment when the next batch is generated. A batch missed while the machine was asleep runs once it is back."
        resetAction={
          isTimeDirty ? (
            <SettingResetButton
              label="home suggestions time"
              onClick={() =>
                updateSettings({
                  homeSuggestionsTime: DEFAULT_UNIFIED_SETTINGS.homeSuggestionsTime,
                })
              }
            />
          ) : null
        }
        control={
          <Input
            type="time"
            step={60}
            className="w-32"
            aria-label="Home suggestions time"
            key={settings.homeSuggestionsTime}
            defaultValue={settings.homeSuggestionsTime}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (
                HOME_SUGGESTIONS_TIME_PATTERN.test(value) &&
                value !== settings.homeSuggestionsTime
              ) {
                updateSettings({ homeSuggestionsTime: value });
              }
            }}
          />
        }
      />

      <SettingsRow
        {...searchableSetting("home-suggestions-generate")}
        description="Generate a fresh batch for this environment right now instead of waiting for the daily run."
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={environmentId === null || !settings.homeSuggestionsEnabled || generating}
            onClick={() => void generateNow()}
          >
            <RefreshIcon className="size-4" />
            Generate now
          </Button>
        }
      />
    </SettingsSection>
  );
}
