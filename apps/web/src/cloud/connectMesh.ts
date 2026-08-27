import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import type { Discovery } from "@t3tools/client-runtime/relay";
import * as Option from "effect/Option";

export const RELAY_MEMBERSHIP_OBSERVED_STORAGE_KEY = "t3code:relay-membership-observed:v1";
const observedRelayMemberships = new Set<EnvironmentId>();

function readObservedRelayMemberships(): string[] {
  const value = localStorage.getItem(RELAY_MEMBERSHIP_OBSERVED_STORAGE_KEY);
  if (value === null) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

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

export function hasObservedRelayMembership(environmentId: EnvironmentId): boolean {
  if (observedRelayMemberships.has(environmentId)) return true;
  try {
    const observed = readObservedRelayMemberships().includes(environmentId);
    if (observed) observedRelayMemberships.add(environmentId);
    return observed;
  } catch {
    // Without durable history, do not risk undoing an explicit account removal.
    return true;
  }
}

export function rememberRelayMembership(environmentId: EnvironmentId): void {
  observedRelayMemberships.add(environmentId);
  try {
    const observed = readObservedRelayMemberships();
    if (observed.includes(environmentId)) return;
    localStorage.setItem(
      RELAY_MEMBERSHIP_OBSERVED_STORAGE_KEY,
      JSON.stringify([...observed, environmentId]),
    );
  } catch {
    // The in-memory observation still preserves explicit removal for this launch.
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
