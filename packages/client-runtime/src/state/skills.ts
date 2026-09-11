import { type EnvironmentId, type Skill, type SkillLocation, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  environmentRpcKey,
} from "./runtime.ts";

/** True when this location's CLI can see the skill, through its own folder or one it also reads. */
export function skillVisibleAt(skill: Skill, location: SkillLocation): boolean {
  return skill.presentIn.some((key) => location.reads.includes(key));
}

/** True when the skill has an entry (its home folder or a link) in this location's own folder. */
export function skillLinkedAt(skill: Skill, location: SkillLocation): boolean {
  return skill.presentIn.includes(location.key);
}

/**
 * Atoms for the skill library and marketplace (see `skills.ts` in
 * `@t3tools/contracts`). The library is the host's skill folders as one
 * inventory; per-thread picks live in orchestration state, not here.
 */
export function createSkillAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
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
  // Installs and removals flip the `installed` flag on marketplace skills,
  // so those refetch the listings alongside the library.
  const refreshLibraryAndListings = (
    { environmentId }: { readonly environmentId: EnvironmentId },
    registry: Parameters<
      NonNullable<Parameters<typeof createEnvironmentRpcCommand>[1]["onSettled"]>
    >[1],
  ) =>
    Effect.sync(() => {
      registry.refresh(skillsStateAtom(environmentId));
      registry.refresh(skillMarketplaceListingsAtom(environmentId));
    });
  return {
    skillsStateAtom,
    skillMarketplaceListingsAtom,
    installSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:skills:install",
      tag: WS_METHODS.skillsInstall,
      scheduler,
      concurrency,
      onSettled: refreshLibraryAndListings,
    }),
    uninstallSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:skills:uninstall",
      tag: WS_METHODS.skillsUninstall,
      scheduler,
      concurrency,
      onSettled: refreshLibraryAndListings,
    }),
    setSkillLocationEnabled: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:skills:set-location-enabled",
      tag: WS_METHODS.skillsSetLocationEnabled,
      scheduler,
      concurrency,
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => {
          registry.refresh(skillsStateAtom(environmentId));
        }),
    }),
    refreshSkillMarketplace: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:skills:refresh-marketplace",
      tag: WS_METHODS.skillsRefreshMarketplace,
      // Per repo: refreshing one source must not swallow a refresh of another.
      concurrency: {
        mode: "singleFlight",
        key: environmentRpcKey,
      },
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => {
          registry.refresh(skillMarketplaceListingsAtom(environmentId));
        }),
    }),
  };
}
