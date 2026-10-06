import type { EnvironmentId, HostResourcesSnapshot } from "@t3tools/contracts";
import { Atom, type AsyncResult } from "effect/reactivity";

export const LOAD_BALANCING_PREFERENCES = [
  { value: 100, label: "Prefer", description: "Favor this machine when resources are available." },
  { value: 50, label: "Normal", description: "Choose based on available CPU and memory." },
  { value: 25, label: "Less often", description: "Reduce this machine's share of new threads." },
  { value: 0, label: "Manual only", description: "Exclude this machine from automatic selection." },
] as const;

/** Older clients saved continuous weights; display the nearest preference. */
export function loadPreferenceForWeight(weight: number | undefined) {
  if (weight === undefined || weight === 50) return 50;
  if (weight === 0) return 0;
  return weight < 50 ? 25 : 100;
}

/** Only unresolved drafts subscribe, so routing does not poll idle clients. */
export function createLoadBalancingResourcesAtom(
  environmentIds: readonly EnvironmentId[],
  hostResources: (input: {
    environmentId: EnvironmentId;
    input: Record<string, never>;
  }) => Atom.Atom<AsyncResult.AsyncResult<HostResourcesSnapshot, unknown>>,
) {
  return Atom.make((get) =>
    environmentIds.map((environmentId) => {
      const result = get(hostResources({ environmentId, input: {} }));
      return {
        environmentId,
        resources: result._tag === "Success" ? result.value : null,
        receivedAt: result._tag === "Success" ? result.timestamp : 0,
        pending: result._tag === "Initial" || result.waiting,
        failed: result._tag === "Failure",
      };
    }),
  );
}

/** Explicit machine and workspace choices keep a draft on its current machine. */
export function shouldAutoBalanceDraft(input: {
  readonly enabled: boolean;
  readonly selection: "auto" | "manual" | undefined;
  readonly hasAttachments: boolean;
  readonly assignedEnvironmentId: string | null | undefined;
  readonly branch: string | null | undefined;
  readonly worktreePath: string | null | undefined;
}) {
  return (
    input.enabled &&
    input.selection !== "manual" &&
    (!input.hasAttachments || Boolean(input.assignedEnvironmentId)) &&
    (!input.branch || input.selection === "auto") &&
    !input.worktreePath
  );
}

/** Callers supply only connected machines hosting the project and selected provider. */
export function chooseLoadBalancedEnvironment(
  candidates: ReadonlyArray<{
    environmentId: string;
    resources: HostResourcesSnapshot | null;
    /** Client receipt time avoids comparing clocks on different machines. */
    receivedAt?: number;
    weight: number;
  }>,
  now: number,
): string | null {
  let selected: string | null = null;
  let bestScore = 0;
  for (const { environmentId, resources, receivedAt, weight } of candidates) {
    const sampledAt = receivedAt ?? resources?.sampledAt ?? 0;
    if (
      !resources ||
      !Number.isFinite(weight) ||
      weight <= 0 ||
      now - sampledAt > 15_000 ||
      sampledAt > now + 5_000 ||
      resources.cpuUtilization === null ||
      resources.cpuUtilization >= 0.95 ||
      resources.totalMemoryBytes <= 0 ||
      resources.cpuCount <= 0
    ) {
      continue;
    }
    const memoryAvailable = resources.availableMemoryBytes / resources.totalMemoryBytes;
    if (memoryAvailable <= 0.05) continue;
    const score =
      weight * resources.cpuCount * (1 - resources.cpuUtilization) * resources.availableMemoryBytes;
    if (score > bestScore) {
      selected = environmentId;
      bestScore = score;
    }
  }
  return selected;
}

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
 * `ready` and `error` are finished probes. A `warning` snapshot that still
 * only lists the built-in `grok-build` stub is the first probe, even after
 * version or auth has been filled in. A warning snapshot that lists any
 * other model has a real catalog.
 */
function catalogSettled(provider: LoadBalancingHostProvider): boolean {
  if (provider.status === "ready" || provider.status === "error") return true;
  const listsMoreThanStub = provider.models.some((model) => model.slug !== "grok-build");
  if (!listsMoreThanStub) return false;
  return provider.version !== null || provider.authStatus !== "unknown";
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
