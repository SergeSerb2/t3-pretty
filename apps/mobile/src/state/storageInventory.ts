/**
 * Multi-environment storage inventory.
 *
 * Mirror of `apps/web/src/state/storageInventory.ts` over mobile's atom wiring.
 * Prefers `storage.streamInventory` when the environment advertises it.
 *
 * @module state/storageInventory
 */
import { useAtomValue } from "@effect/atom-react";
import { usageConnectionPlan } from "@t3tools/client-runtime/connection";
import type { EnvironmentId, StorageInventory } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { appAtomRegistry } from "./atom-registry";
import { environmentPresentations } from "./presentation";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";

export interface EnvironmentStorageStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPending: boolean;
  readonly unsupported: boolean;
  readonly error: string | null;
  readonly inventory: StorageInventory | null;
}

const storageInventoriesAtom = Atom.make((get): readonly EnvironmentStorageStatus[] => {
  const presentations = get(environmentPresentations.presentationsAtom);
  const configs = get(environmentServerConfigsAtom);
  const statuses: EnvironmentStorageStatus[] = [];

  for (const [environmentId, presentation] of presentations) {
    const plan = usageConnectionPlan(presentation.connection.phase);
    if (plan === "skip") {
      continue;
    }
    if (plan === "await-connect") {
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        isPending: true,
        unsupported: false,
        error: null,
        inventory: null,
      });
      continue;
    }
    const config = configs.get(environmentId);
    if (config === undefined) {
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        isPending: true,
        unsupported: false,
        error: null,
        inventory: null,
      });
      continue;
    }
    if (config.environment.capabilities.storageInventory !== true) {
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        isPending: false,
        unsupported: true,
        error: null,
        inventory: null,
      });
      continue;
    }
    const result =
      config.environment.capabilities.storageInventoryStream === true
        ? get(serverEnvironment.storageInventoryStream({ environmentId, input: {} }))
        : get(serverEnvironment.storageInventory({ environmentId, input: {} }));
    const inventory = Option.getOrNull(AsyncResult.value(result));
    statuses.push({
      environmentId,
      label: presentation.entry.target.label,
      isPending: result.waiting,
      unsupported: false,
      error: result._tag === "Failure" ? "This environment could not report storage." : null,
      inventory,
    });
  }
  return statuses;
}).pipe(Atom.withLabel("mobile-storage-inventory"));

export interface StorageInventoryView {
  readonly environments: readonly EnvironmentStorageStatus[];
  readonly isPending: boolean;
  readonly refresh: () => void;
}

export function useStorageInventories(): StorageInventoryView {
  const environments = useAtomValue(storageInventoriesAtom);

  const refresh = useCallback(() => {
    for (const environment of environments) {
      if (environment.unsupported) continue;
      appAtomRegistry.refresh(
        serverEnvironment.storageInventory({
          environmentId: environment.environmentId,
          input: {},
        }),
      );
      appAtomRegistry.refresh(
        serverEnvironment.storageInventoryStream({
          environmentId: environment.environmentId,
          input: {},
        }),
      );
    }
  }, [environments]);

  return {
    environments,
    isPending: environments.some(
      (environment) =>
        !environment.unsupported && environment.isPending && environment.error === null,
    ),
    refresh,
  };
}

export function refreshStorageInventory(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(
    serverEnvironment.storageInventory({
      environmentId,
      input: {},
    }),
  );
  appAtomRegistry.refresh(
    serverEnvironment.storageInventoryStream({
      environmentId,
      input: {},
    }),
  );
}
