import type { ScopedAutomationRef } from "@t3tools/client-runtime/state/automations";
import { AutomationId, ENTITY_ID_MAX_LENGTH, EnvironmentId } from "@t3tools/contracts";

/** Deep links deliver both ids as strings, so the screen normalizes them itself. */
export type AutomationDetailRouteParams = {
  readonly environmentId: string;
  readonly automationId: string;
};

function boundedRouteValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= ENTITY_ID_MAX_LENGTH ? trimmed : null;
}

/** The automation a route names, or `null` when the link cannot name one. */
export function parseAutomationDetailRoute(
  params: AutomationDetailRouteParams,
): ScopedAutomationRef | null {
  const environmentId = boundedRouteValue(params.environmentId);
  const automationId = boundedRouteValue(params.automationId);
  if (environmentId === null || automationId === null) {
    return null;
  }
  return {
    environmentId: EnvironmentId.make(environmentId),
    automationId: AutomationId.make(automationId),
  };
}

export function automationDetailRouteParams(ref: ScopedAutomationRef): AutomationDetailRouteParams {
  return { environmentId: String(ref.environmentId), automationId: String(ref.automationId) };
}
