/**
 * Settings › Agents — global subagent switch and per-instance default child.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SUBAGENT_POLICY_SETTINGS,
  ProviderInstanceId,
  type SubagentChildSelection,
  subagentPolicyBindForDriver,
  subagentPolicyBindCaption,
} from "@t3tools/contracts";
import { useMemo } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import {
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "~/state/server";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function AgentsSettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const instances = useMemo(
    () => deriveProviderInstanceEntries(serverProviders).filter((entry) => entry.enabled),
    [serverProviders],
  );
  const modelOptionsByInstance = useMemo(() => {
    const map = new Map<ProviderInstanceId, (typeof instances)[number]["models"]>();
    for (const entry of instances) {
      map.set(entry.instanceId, entry.models);
    }
    return map;
  }, [instances]);
  const policy = settings.subagentPolicy ?? DEFAULT_SUBAGENT_POLICY_SETTINGS;

  const setEnabled = (enabled: boolean) => {
    updateSettings({ subagentPolicy: { enabled } });
  };

  const setChild = (instanceId: ProviderInstanceId, child: SubagentChildSelection | null) => {
    const nextChildren = { ...policy.children };
    if (child === null) {
      delete nextChildren[instanceId];
    } else {
      nextChildren[instanceId] = child;
    }
    updateSettings({ subagentPolicy: { children: nextChildren } });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="Subagents">
        <SettingsRow
          {...searchableSetting("subagents-enabled")}
          description="Threads without an override follow this. Off means no new spawns; children already running keep going until you stop them."
          control={
            <Switch
              checked={policy.enabled}
              onCheckedChange={(checked) => setEnabled(Boolean(checked))}
              aria-label="Use subagents"
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        {...searchableSetting("subagents-default-child")}
        title="Default child model"
      >
        <p className="text-muted-foreground max-w-2xl text-sm">
          When a thread may spawn, the child uses this model instead of cloning the parent. Leave a
          provider on Automatic to pick a cheaper sibling of whatever model the thread is using. T3
          does not spawn children itself — it asks the provider. Claude can apply the child model on
          the next new session. Everyone else is hinted each turn.
        </p>
        {instances.length === 0 ? (
          <p className="text-muted-foreground text-sm">Enable a provider to set a default child.</p>
        ) : (
          instances.map((entry) => {
            const instanceId = entry.instanceId;
            const child = policy.children[instanceId];
            const bind = subagentPolicyBindForDriver(entry.driverKind);
            return (
              <SettingsRow
                key={entry.instanceId}
                title={entry.displayName}
                description={subagentPolicyBindCaption(bind)}
                control={
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {child === undefined ? (
                      <span className="text-muted-foreground text-sm">Automatic</span>
                    ) : (
                      <>
                        <ProviderModelPicker
                          activeInstanceId={instanceId}
                          model={child.model}
                          lockedProvider={null}
                          instanceEntries={[entry]}
                          modelOptionsByInstance={modelOptionsByInstance}
                          triggerVariant="outline"
                          triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                          onInstanceModelChange={(_nextInstanceId, model) => {
                            setChild(instanceId, { model, options: child.options });
                          }}
                        />
                        <TraitsPicker
                          provider={entry.driverKind}
                          models={entry.models}
                          model={child.model}
                          prompt=""
                          onPromptChange={() => {}}
                          modelOptions={child.options}
                          allowPromptInjectedEffort={false}
                          planModeEnabled={settings.planModeEnabled}
                          triggerVariant="outline"
                          triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                          onModelOptionsChange={(nextOptions) => {
                            setChild(instanceId, { model: child.model, options: nextOptions });
                          }}
                        />
                      </>
                    )}
                    <Button
                      size="sm"
                      variant={child === undefined ? "outline" : "ghost"}
                      onClick={() => {
                        if (child !== undefined) {
                          setChild(instanceId, null);
                          return;
                        }
                        const model =
                          getDefaultProviderInstanceModel(serverProviders, instanceId) ??
                          entry.models[0]?.slug;
                        if (model !== undefined && model.length > 0) {
                          setChild(instanceId, { model });
                        }
                      }}
                    >
                      {child === undefined ? "Pin model" : "Automatic"}
                    </Button>
                  </div>
                }
              />
            );
          })
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
