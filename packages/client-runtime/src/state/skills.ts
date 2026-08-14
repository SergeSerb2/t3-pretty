import {
  type EnvironmentId,
  type InstalledSkill,
  type ServerSettings,
  type SkillsState,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

const EMPTY_GLOBALLY_ENABLED_SKILLS: ReadonlyArray<InstalledSkill> = [];

/**
 * Skills enabled globally in server settings, resolved against the installed
 * registry. Enabled ids that are not installed (e.g. uninstalled from another
 * device) drop out; the result follows install order.
 */
export function globallyEnabledSkills(
  settings: ServerSettings | null,
  state: SkillsState | null,
): ReadonlyArray<InstalledSkill> {
  const enabledSkillIds = settings?.skills.enabledSkillIds;
  if (enabledSkillIds === undefined || enabledSkillIds.length === 0 || state === null) {
    return EMPTY_GLOBALLY_ENABLED_SKILLS;
  }
  const enabled = new Set(enabledSkillIds);
  return state.installedSkills.filter((skill) => enabled.has(skill.id));
}

/**
 * Atoms for the server-managed skill registry and marketplace (see `skills.ts`
 * in `@t3tools/contracts`). Enablement lives in server settings and per-thread
 * orchestration state — this module only mirrors the store and the listings.
 */
export function createSkillAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  options: {
    readonly settingsValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerSettings | null>;
  },
) {
  const storeScheduler = createAtomCommandScheduler();
  const storeConcurrency = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };
  const state = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:skills:state",
    tag: WS_METHODS.skillsGetState,
  });
  const marketplaceListings = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:skills:marketplace-listings",
    tag: WS_METHODS.skillsListMarketplace,
  });
  const skillsStateAtom = (environmentId: EnvironmentId) => state({ environmentId, input: {} });
  const skillMarketplaceListingsAtom = (environmentId: EnvironmentId) =>
    marketplaceListings({ environmentId, input: {} });
  const globallyEnabledSkillsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<InstalledSkill> =>
        globallyEnabledSkills(
          get(options.settingsValueAtom(environmentId)),
          Option.getOrNull(AsyncResult.value(get(skillsStateAtom(environmentId)))),
        ),
    ).pipe(Atom.withLabel(`environment-data:skills:globally-enabled:${environmentId}`)),
  );
  // Installs flip the `installed` flag on marketplace skills, so store
  // mutations refetch the listings alongside the registry snapshot.
  const refreshStoreQueries = (
    { environmentId }: { readonly environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() => {
      registry.refresh(skillsStateAtom(environmentId));
      registry.refresh(skillMarketplaceListingsAtom(environmentId));
    });
  return {
    skillsStateAtom,
    skillMarketplaceListingsAtom,
    globallyEnabledSkillsAtom,
    installSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:skills:install",
      tag: WS_METHODS.skillsInstall,
      scheduler: storeScheduler,
      concurrency: storeConcurrency,
      onSettled: refreshStoreQueries,
    }),
    uninstallSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:skills:uninstall",
      tag: WS_METHODS.skillsUninstall,
      scheduler: storeScheduler,
      concurrency: storeConcurrency,
      onSettled: refreshStoreQueries,
    }),
    refreshSkillMarketplace: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:skills:refresh-marketplace",
      tag: WS_METHODS.skillsRefreshMarketplace,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId }) => environmentId,
      },
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => {
          registry.refresh(skillMarketplaceListingsAtom(environmentId));
        }),
    }),
  };
}
