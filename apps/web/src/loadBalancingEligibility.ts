/**
 * Auto-balance may only land a new thread on a machine that can run the
 * selected model. Provider catalogs are per machine: Grok's first snapshot
 * lists only `grok-build`, and a settled snapshot on an older CLI can omit
 * `grok-4.7-build-fast` entirely. Treating that stub as the final catalog
 * pins the draft to a machine whose picker then drops the model.
 */

export interface LoadBalancingModelTarget {
  readonly instanceId: string | null;
  readonly driver: string;
  readonly model: string | null;
  /** A settings-defined custom slug is sent as-is, so the catalog need not list it. */
  readonly customModel: boolean;
}

export interface LoadBalancingHostProvider {
  readonly instanceId: string;
  readonly driver: string;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly status: string;
  readonly authStatus: string;
  readonly availability?: string | undefined;
  readonly version: string | null;
  readonly models: ReadonlyArray<{
    readonly slug: string;
    readonly aliases?: ReadonlyArray<string> | undefined;
  }>;
}

export interface LoadBalancingHost {
  readonly environmentId: string;
  readonly connected: boolean;
  readonly weight: number;
  readonly providers: ReadonlyArray<LoadBalancingHostProvider>;
}

export type LoadBalancingHostVerdict = "eligible" | "pending" | "ineligible";

function providerMatchesTarget(
  provider: LoadBalancingHostProvider,
  target: LoadBalancingModelTarget,
): boolean {
  return (
    (target.instanceId === null || provider.instanceId === target.instanceId) &&
    provider.driver === target.driver &&
    provider.enabled &&
    provider.installed &&
    provider.status !== "error" &&
    provider.authStatus !== "unauthenticated" &&
    provider.availability !== "unavailable"
  );
}

function catalogListsModel(provider: LoadBalancingHostProvider, model: string): boolean {
  return provider.models.some(
    (entry) => entry.slug === model || entry.aliases?.includes(model) === true,
  );
}

/**
 * A probe that has not finished leaves version null and auth unknown.
 * `ready` / `error`, a parsed version, or any decided auth state means the
 * catalog is the one the machine will keep.
 */
function catalogSettled(provider: LoadBalancingHostProvider): boolean {
  return (
    provider.status === "ready" ||
    provider.status === "error" ||
    provider.version !== null ||
    provider.authStatus !== "unknown"
  );
}

export function loadBalancingHostVerdict(
  host: LoadBalancingHost,
  target: LoadBalancingModelTarget,
): LoadBalancingHostVerdict {
  if (!host.connected || !Number.isFinite(host.weight) || host.weight <= 0) {
    return "ineligible";
  }
  const providers = host.providers.filter((provider) => providerMatchesTarget(provider, target));
  if (providers.length === 0) {
    return "ineligible";
  }
  const model = target.model?.trim() ?? "";
  if (model.length === 0 || target.customModel) {
    return "eligible";
  }
  if (providers.some((provider) => catalogListsModel(provider, model))) {
    return "eligible";
  }
  if (providers.some((provider) => !catalogSettled(provider))) {
    return "pending";
  }
  return "ineligible";
}

export function partitionLoadBalancingHosts(
  hosts: ReadonlyArray<LoadBalancingHost>,
  target: LoadBalancingModelTarget,
): {
  readonly eligibleEnvironmentIds: ReadonlyArray<string>;
  readonly pending: boolean;
} {
  const eligibleEnvironmentIds: string[] = [];
  let pending = false;
  for (const host of hosts) {
    const verdict = loadBalancingHostVerdict(host, target);
    if (verdict === "eligible") {
      eligibleEnvironmentIds.push(host.environmentId);
    } else if (verdict === "pending") {
      pending = true;
    }
  }
  return {
    eligibleEnvironmentIds,
    pending: eligibleEnvironmentIds.length === 0 && pending,
  };
}

/** True when a saved auto-balance pick can no longer run the selected model. */
export function loadBalancedAssignmentIsStale(
  assignedEnvironmentId: string | null | undefined,
  hosts: ReadonlyArray<LoadBalancingHost>,
  target: LoadBalancingModelTarget,
): boolean {
  if (!assignedEnvironmentId) return false;
  const host = hosts.find((candidate) => candidate.environmentId === assignedEnvironmentId);
  if (!host) return true;
  return loadBalancingHostVerdict(host, target) === "ineligible";
}
