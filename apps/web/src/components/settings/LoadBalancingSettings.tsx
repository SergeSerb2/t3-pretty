import { useAtomValue } from "@effect/atom-react";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import {
  describeAgentPerf,
  LOAD_BALANCING_PREFERENCES as preferences,
  loadPreferenceForWeight,
} from "@t3tools/client-runtime/load-balancing";

export { loadPreferenceForWeight } from "@t3tools/client-runtime/load-balancing";

import {
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
  useUpdatePrimarySettings,
} from "~/hooks/useSettings";
import type { EnvironmentPresentation } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { EnvironmentRow, environmentTransportLabel } from "./EnvironmentRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { searchableSetting } from "./settingsSearch";

type LoadPreference = (typeof preferences)[number]["value"];

function preferenceLabel(preference: LoadPreference): string {
  return preferences.find((entry) => entry.value === preference)!.label;
}

/**
 * Closed-header summary: the machines not at Normal, so the folded section
 * still tells you what is set. Null when every machine is at the default.
 */
export function summarizeLoadPreferences(
  environments: ReadonlyArray<Pick<EnvironmentPresentation, "environmentId" | "label">>,
  weights: Readonly<Record<string, number>>,
): string | null {
  const parts = environments.flatMap((environment) => {
    const preference = loadPreferenceForWeight(weights[environment.environmentId]);
    return preference === 50
      ? []
      : [`${environment.label} ${preferenceLabel(preference).toLowerCase()}`];
  });
  return parts.length === 0 ? null : parts.join(" · ");
}

/** A machine row with its Agent Perf score, and why the last run failed if it did. */
function BenchmarkedEnvironmentRow({
  environment,
  ...props
}: Omit<ComponentProps<typeof EnvironmentRow>, "subtitle" | "below"> & {
  readonly environment: EnvironmentPresentation;
}) {
  const result = useAtomValue(
    serverEnvironment.hostResources({ environmentId: environment.environmentId, input: {} }),
  );
  const transport = environmentTransportLabel(environment);
  const agentPerf = result._tag === "Success" ? result.value.agentPerf : undefined;
  const benchmark = agentPerf === undefined ? null : describeAgentPerf(agentPerf);
  return (
    <EnvironmentRow
      {...props}
      subtitle={benchmark === null ? transport : `${transport} · ${benchmark.label}`}
      below={
        benchmark?.error ? <p className="text-xs text-muted-foreground">{benchmark.error}</p> : null
      }
    />
  );
}

/**
 * Folded section under the environments list. Its switch turns balancing on
 * for this client, and the body holds one row per switched-on machine with
 * how often that machine should receive new threads. Rendered only when two
 * or more machines are on, since one machine has nothing to balance against.
 */
export function LoadBalancingSettings({
  environments,
}: {
  environments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const settings = useClientSettings();
  const settingsHydrated = useClientSettingsHydrated();
  const updateSettings = useUpdateClientSettings();
  // A shared server setting: the write reaches every connected machine.
  const updateServerSettings = useUpdatePrimarySettings();

  if (environments.length < 2) return null;

  const benchmarkMachines = environments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.agentPerfBenchmark === true,
  );
  const benchmarksOn = benchmarkMachines.some(
    (environment) => environment.serverConfig?.settings.agentPerfBenchmarks === true,
  );

  const { id, title } = searchableSetting("load-balancing");
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={
        settings.loadBalancingEnabled
          ? summarizeLoadPreferences(environments, settings.loadBalancingWeights)
          : "Off"
      }
      control={
        <Switch
          aria-label="Automatically balance load"
          checked={settings.loadBalancingEnabled}
          disabled={!settingsHydrated}
          onCheckedChange={(loadBalancingEnabled) => updateSettings({ loadBalancingEnabled })}
        />
      }
    >
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        New threads in shared projects start on the machine with the most free CPU and memory,
        weighted by each machine's preference and, when measured, its Agent Perf score.
      </p>
      {benchmarkMachines.length > 0 ? (
        <div className="flex items-center justify-between gap-4 px-3 py-2.5 sm:px-4">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Benchmark machines weekly</p>
            <p className="text-xs text-muted-foreground">
              Each machine runs Agent Perf for a few minutes about once a week, only while it is
              idle, and stops when an agent starts. Needs Python 3.8 or newer.
            </p>
          </div>
          <Switch
            aria-label="Benchmark machines weekly"
            checked={benchmarksOn}
            disabled={!benchmarksOn && !settings.loadBalancingEnabled}
            onCheckedChange={(agentPerfBenchmarks) =>
              updateServerSettings({ agentPerfBenchmarks: Boolean(agentPerfBenchmarks) })
            }
          />
        </div>
      ) : null}
      {environments.map((environment) => {
        const row = {
          kind: resolveEnvironmentMachineKind(environment.serverConfig),
          label: environment.label,
          children: (
            <Select
              items={preferences}
              value={loadPreferenceForWeight(
                settings.loadBalancingWeights[environment.environmentId],
              )}
              disabled={!settingsHydrated || !settings.loadBalancingEnabled}
              onValueChange={(value) => {
                if (value === null) return;
                updateSettings({
                  loadBalancingWeights: {
                    ...settings.loadBalancingWeights,
                    [environment.environmentId]: value,
                  },
                });
              }}
            >
              <SelectTrigger
                size="xs"
                className="w-32"
                aria-label={`${environment.label} load preference`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {preferences.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ),
        };
        return benchmarksOn &&
          environment.serverConfig?.environment.capabilities.agentPerfBenchmark === true ? (
          <BenchmarkedEnvironmentRow
            key={environment.environmentId}
            environment={environment}
            {...row}
          />
        ) : (
          <EnvironmentRow
            key={environment.environmentId}
            subtitle={environmentTransportLabel(environment)}
            {...row}
          />
        );
      })}
    </FoldedSettingsSection>
  );
}
