/**
 * Multi-environment storage inventory.
 *
 * Connected environments that advertise `storageInventory` answer the same
 * typed query. Servers that also advertise `storageInventoryStream` push
 * incremental inventories while the walk is still running. Offline
 * environments and older servers are not probed.
 *
 * @module state/storageInventory
 */
import { useAtomValue } from "@effect/atom-react";
import {
  usageConnectionPlan,
  type ConnectionTarget,
  type EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId, StorageInventory } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";

export interface EnvironmentStorageStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly target: ConnectionTarget;
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly isPending: boolean;
  readonly unsupported: boolean;
  readonly error: string | null;
  readonly inventory: StorageInventory | null;
}

export const STORAGE_INVENTORY_MAX_ENVIRONMENTS = 32;

interface StorageInventoriesSnapshot {
  readonly environments: readonly EnvironmentStorageStatus[];
  readonly omittedEnvironmentCount: number;
}

const storageInventoriesAtom = Atom.make((get): StorageInventoriesSnapshot => {
  const presentations = get(environmentPresentations.presentationsAtom);
  const configs = get(environmentServerConfigsAtom);
  const statuses: EnvironmentStorageStatus[] = [];
  let eligibleEnvironmentCount = 0;

  for (const [environmentId, presentation] of presentations) {
    const plan = usageConnectionPlan(presentation.connection.phase);
    if (plan === "skip") {
      continue;
    }
    eligibleEnvironmentCount += 1;
    // An inventory scan can walk thousands of paths on every target. Keep a
    // fleet-sized catalog from starting all of those scans when Storage opens;
    // the UI reports the omitted tail explicitly.
    if (statuses.length >= STORAGE_INVENTORY_MAX_ENVIRONMENTS) {
      continue;
    }
    if (plan === "await-connect") {
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        target: presentation.entry.target,
        connectionPhase: presentation.connection.phase,
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
        target: presentation.entry.target,
        connectionPhase: presentation.connection.phase,
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
        target: presentation.entry.target,
        connectionPhase: presentation.connection.phase,
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
      target: presentation.entry.target,
      connectionPhase: presentation.connection.phase,
      isPending: result.waiting,
      unsupported: false,
      error: result._tag === "Failure" ? "This environment could not report storage." : null,
      inventory,
    });
  }
  return {
    environments: statuses,
    omittedEnvironmentCount: Math.max(0, eligibleEnvironmentCount - statuses.length),
  };
}).pipe(Atom.withLabel("web-storage-inventory"));

export interface StorageInventoryView {
  readonly environments: readonly EnvironmentStorageStatus[];
  readonly isPending: boolean;
  readonly omittedEnvironmentCount: number;
  readonly refresh: () => void;
}

export function useStorageInventories(): StorageInventoryView {
  const snapshot = useAtomValue(storageInventoriesAtom);
  const environments = snapshot.environments;

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
    omittedEnvironmentCount: snapshot.omittedEnvironmentCount,
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
