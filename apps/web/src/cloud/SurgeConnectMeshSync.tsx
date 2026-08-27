import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { useEffect, useMemo, useRef } from "react";

import { environmentCatalog } from "../connection/catalog";
import { isElectron } from "../env";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { usePrimaryEnvironmentId, useRelayEnvironmentDiscovery } from "../state/environments";
import { relayEnvironmentDiscovery } from "../state/relay";
import { useAtomCommand } from "../state/use-atom-command";
import { buildRelayMeshRegistrations } from "./connectMesh";
import { useCloudLinkController } from "./useCloudLinkController";

/**
 * Keeps a signed-in desktop's local connection catalog aligned with the relay
 * account once its own backend participates in Surge Connect. Browser clients
 * and headless servers stay explicit, one-way consumers.
 */
export function SurgeConnectMeshSync() {
  const controller = useCloudLinkController();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const discovery = useRelayEnvironmentDiscovery();
  const refreshRelayCatalog = useAtomCommand(relayEnvironmentDiscovery.refreshCatalog, {
    reportFailure: false,
  });
  const reconcileRelayEnvironments = useAtomCommand(environmentCatalog.reconcileRelayEnvironments, {
    reportFailure: true,
  });
  const migrationAttemptRef = useRef<string | null>(null);
  const lastReconciliationRef = useRef<string | null>(null);
  const meshActive =
    isElectron &&
    controller.isSignedIn === true &&
    controller.managedTunnelActive &&
    primaryEnvironmentId !== null;

  useLiveRefresh(
    () => {
      void refreshRelayCatalog();
    },
    { enabled: meshActive, key: "surge-connect-mesh" },
  );

  useEffect(() => {
    const state = controller.linkState.data;
    const target = controller.linkState.target;
    if (
      !isElectron ||
      controller.isSignedIn !== true ||
      controller.linkState.isPending ||
      !controller.storedLinked ||
      controller.linked ||
      state === null ||
      target === null
    ) {
      return;
    }
    const migrationKey = [
      target.environmentId,
      state.cloudUserId,
      state.relayUrl,
      controller.storedManagedTunnelActive,
      controller.storedPublishAgentActivity,
    ].join("\n");
    if (migrationAttemptRef.current === migrationKey) {
      return;
    }
    migrationAttemptRef.current = migrationKey;
    void controller.reconcileCloudState({
      managedTunnel: controller.storedManagedTunnelActive,
      publish: controller.storedPublishAgentActivity,
    });
  }, [controller]);

  const registrations = useMemo(
    () =>
      primaryEnvironmentId === null
        ? []
        : buildRelayMeshRegistrations(discovery.environments.values(), primaryEnvironmentId),
    [discovery.environments, primaryEnvironmentId],
  );
  const reconciliationKey = registrations
    .map(({ target }) => `${target.environmentId}\n${target.label}`)
    .join("\n\n");

  useEffect(() => {
    if (discovery.refreshing || !discovery.loaded) {
      lastReconciliationRef.current = null;
      return;
    }
    if (
      !meshActive ||
      discovery.offline ||
      Option.isSome(discovery.error) ||
      lastReconciliationRef.current === reconciliationKey
    ) {
      return;
    }
    lastReconciliationRef.current = reconciliationKey;
    void reconcileRelayEnvironments(registrations).then((result) => {
      if (
        result._tag === "Failure" &&
        isAtomCommandInterrupted(result) &&
        lastReconciliationRef.current === reconciliationKey
      ) {
        lastReconciliationRef.current = null;
      }
    });
  }, [
    discovery.error,
    discovery.loaded,
    discovery.offline,
    discovery.refreshing,
    meshActive,
    reconciliationKey,
    reconcileRelayEnvironments,
    registrations,
  ]);

  return null;
}
