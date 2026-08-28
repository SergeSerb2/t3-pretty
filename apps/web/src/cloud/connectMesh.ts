import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import type { Discovery } from "@t3tools/client-runtime/relay";
import * as Option from "effect/Option";

export function isRelayEnvironmentMissing(
  discovery: Discovery.RelayEnvironmentDiscoveryState,
  environmentId: EnvironmentId | null,
): boolean {
  return (
    environmentId !== null &&
    discovery.loaded &&
    !discovery.refreshing &&
    !discovery.offline &&
    Option.isNone(discovery.error) &&
    !discovery.environments.has(environmentId)
  );
}

export function buildRelayMeshRegistrations(
  environments: Iterable<Discovery.RelayDiscoveredEnvironment>,
  primaryEnvironmentId: EnvironmentId,
): ReadonlyArray<RelayConnectionRegistration> {
  return [...environments]
    .filter(({ environment }) => environment.environmentId !== primaryEnvironmentId)
    .sort((left, right) =>
      left.environment.environmentId.localeCompare(right.environment.environmentId),
    )
    .map(
      ({ environment }) =>
        new RelayConnectionRegistration({
          target: new RelayConnectionTarget({
            environmentId: environment.environmentId,
            label: environment.label,
          }),
        }),
    );
}
