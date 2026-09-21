import type { EnvironmentId, ThreadAutomationRun } from "@t3tools/contracts";
import { automationRunTriggerLabel } from "@t3tools/shared/automationSchedule";
import { useNavigation } from "@react-navigation/native";
import { Pressable } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { automationEnvironment } from "../../state/automations";
import { useAutomationShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { automationDetailRouteParams } from "./automationNavigation";

/**
 * Slim strip at the top of a run thread's transcript: which automation it
 * belongs to, what triggered it, and a way back to the automation. The trigger
 * lives on the run row, so it fills in once that unary query lands.
 */
export function AutomationRunBanner(props: {
  readonly environmentId: EnvironmentId;
  readonly automationRun: ThreadAutomationRun;
}) {
  const navigation = useNavigation();
  const reference = {
    environmentId: props.environmentId,
    automationId: props.automationRun.automationId,
  };
  const automation = useAutomationShell(reference);
  const runQuery = useEnvironmentQuery(
    automationEnvironment.getRun({
      environmentId: props.environmentId,
      input: { runId: props.automationRun.runId },
    }),
  );
  const trigger = runQuery.data === null ? null : automationRunTriggerLabel(runQuery.data.trigger);
  const label = [
    `Run of ${automation?.name ?? "an automation"}`,
    ...(trigger ? [trigger] : []),
  ].join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open the automation.`}
      disabled={automation === null}
      onPress={() =>
        navigation.navigate("AutomationDetail", automationDetailRouteParams(reference))
      }
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
      className="mb-2 flex-row items-center gap-2 rounded-2xl bg-subtle px-3 py-2"
    >
      <SymbolView name="bolt" size={13} tintColorClassName="accent-icon" type="monochrome" />
      <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
        {label}
      </Text>
      {automation === null ? null : (
        <SymbolView
          name="chevron.right"
          size={11}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
        />
      )}
    </Pressable>
  );
}
