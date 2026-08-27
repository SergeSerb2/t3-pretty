import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import type { Discovery } from "@t3tools/client-runtime/relay";
import * as Option from "effect/Option";

export const RELAY_MEMBERSHIP_OBSERVED_STORAGE_KEY = "t3code:relay-membership-observed:v1";

function isRelayDiscoveryAuthoritative(
  discovery: Discovery.RelayEnvironmentDiscoveryState,
): boolean {
  return (
    discovery.loaded &&
    !discovery.refreshing &&
    !discovery.offline &&
    Option.isNone(discovery.error)
  );
}

export function isRelayEnvironmentMissing(
  discovery: Discovery.RelayEnvironmentDiscoveryState,
  environmentId: EnvironmentId | null,
): boolean {
  return (
    environmentId !== null &&
    isRelayDiscoveryAuthoritative(discovery) &&
    !discovery.environments.has(environmentId)
  );
}

export function isRelayEnvironmentPresent(
  discovery: Discovery.RelayEnvironmentDiscoveryState,
  environmentId: EnvironmentId | null,
): boolean {
  return (
    environmentId !== null &&
    isRelayDiscoveryAuthoritative(discovery) &&
    discovery.environments.has(environmentId)
  );
}

export function hasObservedRelayMembership(key: string): boolean {
  try {
    return localStorage.getItem(RELAY_MEMBERSHIP_OBSERVED_STORAGE_KEY) === key;
  } catch {
    return false;
  }
}

export function rememberRelayMembership(key: string): void {
  try {
    if (localStorage.getItem(RELAY_MEMBERSHIP_OBSERVED_STORAGE_KEY) !== key) {
      localStorage.setItem(RELAY_MEMBERSHIP_OBSERVED_STORAGE_KEY, key);
    }
  } catch {
    // If storage is unavailable, the bounded in-memory attempt still prevents a loop this launch.
  }
}

export function shouldRepairStoredCloudLink(input: {
  readonly linked: boolean;
  readonly relayMembershipMissing: boolean;
  readonly relayMembershipObserved: boolean;
}): boolean {
  return !input.linked || (input.relayMembershipMissing && !input.relayMembershipObserved);
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
