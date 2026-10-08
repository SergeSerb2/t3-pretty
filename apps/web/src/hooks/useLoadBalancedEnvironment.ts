import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  chooseLoadBalancedEnvironment,
  createLoadBalancingResourcesAtom,
} from "@t3tools/client-runtime/load-balancing";
import type { EnvironmentId } from "@t3tools/contracts";

import { useCallback, useContext, useMemo } from "react";

import { serverEnvironment } from "../state/server";

/** Only mounted for unresolved automatic drafts, so idle clients do not poll hosts. */
export function useLoadBalancedEnvironment(
  environmentIds: readonly EnvironmentId[],
  weights: Readonly<Record<string, number>>,
) {
  const registry = useContext(RegistryContext);
  const refresh = useCallback(
    (ids: readonly EnvironmentId[]) => {
      for (const environmentId of ids) {
        registry.refresh(serverEnvironment.hostResources({ environmentId, input: {} }));
      }
    },
    [registry],
  );
  const resourcesAtom = useMemo(
    () => createLoadBalancingResourcesAtom(environmentIds, serverEnvironment.hostResources),
    [environmentIds],
  );
  const resources = useAtomValue(resourcesAtom);
  const pending = resources.some((resource) => resource.pending);
  const environmentId = chooseLoadBalancedEnvironment(
    resources.map((resource) => ({
      ...resource,
      weight: weights[resource.environmentId] ?? 50,
    })),
    Date.now(),
  ) as EnvironmentId | null;
  return {
    refresh,
    pending,
    environmentId,
    failed: !pending && environmentId === null && resources.some((resource) => resource.failed),
  };
}
