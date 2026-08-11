import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import type { Discovery } from "@t3tools/client-runtime/relay";

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
