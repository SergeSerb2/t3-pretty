import { useAuth } from "@clerk/react";
import { findErrorTraceId } from "@t3tools/client-runtime/errors";
import {
  type EnvironmentConnectionPresentation,
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import { SURGE_CONNECT_NAME } from "@t3tools/shared/connectBranding";
import * as Option from "effect/Option";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import {
  connectionPhaseGroupPriority,
  environmentMachineKey,
  isWorkingConnectionPhase,
  selectVisibleRemoteEnvironmentIds,
} from "~/connection/environmentGrouping";
import { cn } from "~/lib/utils";
import { relayEnvironmentDiscovery } from "~/state/relay";
import { useRelayEnvironmentDiscovery } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "../settings/itemRows";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { presentSavedCloudEnvironmentConnection } from "./cloudEnvironmentConnectionPresentation";
import { isElectron } from "~/env";
import { useCloudLinkController } from "~/cloud/useCloudLinkController";
import { useCopyTraceId } from "~/hooks/useCopyTraceId";

export interface SavedCloudEnvironmentConnection {
  readonly environmentId: EnvironmentId;
  readonly connection: EnvironmentConnectionPresentation;
}

export function RemoteEnvironmentRowsSkeleton() {
  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-32 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
        <Skeleton className="h-7 w-16 rounded-md" />
      </div>
    </div>
  );
}

/**
 * The user's Surge Connect environments from relay discovery, each with a
 * Connect button. The primary environment is always excluded; already-saved
 * environments are hidden unless `showSavedEnvironments` renders them with
 * their live connection state (used by onboarding, where the full device mesh
 * should be visible). Rows for a machine that already has a working saved
 * connection (`hiddenMachineKeys`) are dropped, and duplicate rows for the
 * same machine collapse to the working ones (or a single representative).
 */
export function CloudEnvironmentConnectRows({
  primaryEnvironmentId,
  savedEnvironments,
  showSavedEnvironments = false,
  hiddenMachineKeys,
  empty = null,
}: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly savedEnvironments: ReadonlyArray<SavedCloudEnvironmentConnection>;
  readonly showSavedEnvironments?: boolean;
  readonly hiddenMachineKeys?: ReadonlySet<string>;
  readonly empty?: ReactNode;
}) {
  const { userId } = useAuth({ treatPendingAsSignedOut: false });
  const environmentsState = useRelayEnvironmentDiscovery();
  const registerEnvironment = useAtomCommand(environmentCatalog.register, {
    reportFailure: false,
  });
  const refreshRelayEnvironments = useAtomCommand(relayEnvironmentDiscovery.refresh, {
    reportFailure: false,
  });
  const cloudLinkController = useCloudLinkController();
  const copyTraceId = useCopyTraceId();
  const connectRelayEnvironment = useCallback(
    (environment: RelayClientEnvironmentRecord) =>
      registerEnvironment(
        new RelayConnectionRegistration({
          target: new RelayConnectionTarget({
            environmentId: environment.environmentId,
            label: environment.label,
          }),
        }),
      ),
    [registerEnvironment],
  );
  const [connectingEnvironmentId, setConnectingEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  const activeConnectRef = useRef<symbol | null>(null);
  const activeAccountRef = useRef(userId);
  activeAccountRef.current = userId;
  const previousAccountRef = useRef(userId);
  const savedById = new Map(
    savedEnvironments.map((environment) => [environment.environmentId, environment]),
  );

  useEffect(() => {
    if (previousAccountRef.current === userId) return;
    previousAccountRef.current = userId;
    activeConnectRef.current = null;
    setConnectingEnvironmentId(null);
  }, [userId]);

  useEffect(
    () => () => {
      activeConnectRef.current = null;
    },
    [],
  );

  useEffect(() => {
    void refreshRelayEnvironments();
  }, [refreshRelayEnvironments]);

  const connectEnvironment = async (environment: RelayClientEnvironmentRecord) => {
    if (activeConnectRef.current !== null) return;
    const operation = Symbol("connect-relay-environment");
    const accountId = userId;
    activeConnectRef.current = operation;
    setConnectingEnvironmentId(environment.environmentId);
    const isCurrent = () =>
      activeConnectRef.current === operation && activeAccountRef.current === accountId;
    const finishCurrent = () => {
      if (!isCurrent()) return false;
      activeConnectRef.current = null;
      setConnectingEnvironmentId(null);
      return true;
    };
    const meshReady =
      !isElectron ||
      cloudLinkController.managedTunnelActive ||
      (await cloudLinkController.reconcileCloudState({
        managedTunnel: true,
        publish: cloudLinkController.storedPublishAgentActivity,
      }));
    if (!isCurrent()) return;
    if (!meshReady) {
      finishCurrent();
      return;
    }
    const result = await connectRelayEnvironment(environment);
    if (!isCurrent()) return;
    if (result._tag === "Success") {
      finishCurrent();
      toastManager.add({
        type: "success",
        title: "Environment added",
        description: `Connecting to ${environment.label} through ${SURGE_CONNECT_NAME}.`,
      });
      return;
    }
    if (!finishCurrent()) return;
    if (isAtomCommandInterrupted(result)) {
      return;
    }
    const cause = squashAtomCommandFailure(result);
    const message =
      cause instanceof Error
        ? cause.message
        : `Could not connect the ${SURGE_CONNECT_NAME} environment.`;
    const traceId = findErrorTraceId(cause);
    console.error("[t3-connect] Could not connect environment", { message, traceId, cause });
    toastManager.add({
      type: "error",
      title: "Could not connect environment",
      description: message,
      data: traceId
        ? {
            secondaryActionProps: {
              children: "Copy trace ID",
              onClick: () => copyTraceId(traceId),
            },
          }
        : undefined,
    });
  };

  const visibleEnvironments = [...environmentsState.environments.values()].filter(
    ({ environment }) =>
      environment.environmentId !== primaryEnvironmentId &&
      (showSavedEnvironments || !savedById.has(environment.environmentId)) &&
      !hiddenMachineKeys?.has(environmentMachineKey(environment.label)),
  );

  // Several T3 homes on one machine (installed app, nightly, dev worktrees)
  // publish one environment each under the same machine label. Collapse those
  // to the working rows, or to a single representative when none are working.
  const visibleEnvironmentIds = selectVisibleRemoteEnvironmentIds(
    visibleEnvironments.map(({ environment, availability }) => {
      const savedPhase = savedById.get(environment.environmentId)?.connection.phase ?? null;
      const availabilityPriority =
        availability === "online"
          ? 2
          : availability === "checking"
            ? 3
            : availability === "offline"
              ? 4
              : 5;
      return {
        id: environment.environmentId as string,
        machineKey: environmentMachineKey(environment.label),
        // A saved row ranks by its live connection phase; a relay-verified
        // online home never ranks below an idle sibling.
        priority:
          savedPhase === null
            ? availabilityPriority
            : Math.min(connectionPhaseGroupPriority(savedPhase), availabilityPriority),
        // Verified-online relay availability counts as working even when a
        // saved row exists but its local connection is idle or down.
        working:
          (savedPhase !== null && isWorkingConnectionPhase(savedPhase)) ||
          availability === "online",
      };
    }),
  );
  const dedupedEnvironments = visibleEnvironments.filter(({ environment }) =>
    visibleEnvironmentIds.has(environment.environmentId),
  );

  const standalone = showSavedEnvironments || savedEnvironments.length === 0;

  if (
    standalone &&
    dedupedEnvironments.length === 0 &&
    environmentsState.refreshing &&
    environmentsState.environments.size === 0
  ) {
    return <RemoteEnvironmentRowsSkeleton />;
  }

  if (standalone && dedupedEnvironments.length === 0) {
    // A failed or offline discovery is not "no environments" — misreporting it
    // as empty would read as the user's devices having disappeared.
    const discoveryProblem = environmentsState.offline
      ? "You appear to be offline."
      : (Option.getOrNull(environmentsState.error)?.message ?? null);
    if (discoveryProblem !== null && !environmentsState.refreshing) {
      return (
        <div className={ITEM_ROW_CLASSNAME}>
          <p className="text-sm font-medium text-destructive">
            Could not load {SURGE_CONNECT_NAME} environments
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{discoveryProblem}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void refreshRelayEnvironments()}
          >
            Try again
          </Button>
        </div>
      );
    }
    return empty;
  }

  return dedupedEnvironments.map(({ environment, availability, error }) => {
    const savedEnvironment = savedById.get(environment.environmentId);
    const savedConnection = savedEnvironment
      ? presentSavedCloudEnvironmentConnection(savedEnvironment.connection)
      : null;
    const dotClassName = savedConnection
      ? savedConnection.tone === "connected"
        ? "bg-success"
        : savedConnection.tone === "connecting"
          ? "bg-warning"
          : savedConnection.tone === "error"
            ? "bg-destructive"
            : "bg-muted-foreground/35"
      : availability === "online"
        ? "bg-success"
        : availability === "error"
          ? "bg-destructive"
          : availability === "checking"
            ? "bg-warning"
            : "bg-muted-foreground/35";
    const statusText = savedConnection
      ? savedConnection.statusText
      : availability === "online"
        ? "Available · Relay online"
        : availability === "offline"
          ? "Unavailable · Relay offline"
          : availability === "checking"
            ? "Checking relay status…"
            : (Option.getOrNull(error)?.message ?? "Relay status unavailable");
    return (
      <div key={environment.environmentId} className={ITEM_ROW_CLASSNAME}>
        <div className={ITEM_ROW_INNER_CLASSNAME}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ConnectionStatusDot
                dotClassName={dotClassName}
                pingClassName={
                  savedConnection?.tone === "connecting" ||
                  (savedConnection === null && availability === "checking")
                    ? "bg-warning/60 duration-2000"
                    : null
                }
                tooltipText={
                  savedConnection
                    ? savedConnection.statusText
                    : availability === "online"
                      ? "Relay online"
                      : availability === "offline"
                        ? "Relay offline"
                        : availability === "checking"
                          ? "Checking relay status"
                          : (Option.getOrNull(error)?.message ?? "Relay status unavailable")
                }
              />
              <p className="truncate text-sm font-medium">{environment.label}</p>
            </div>
            <p
              className={cn(
                "mt-1 truncate text-xs",
                savedConnection?.tone === "error" ||
                  (savedConnection?.tone === "connecting" && savedEnvironment?.connection.error) ||
                  (savedConnection === null && availability === "error")
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {statusText}
            </p>
          </div>
          {savedConnection ? (
            <Button size="sm" variant="outline" disabled>
              {savedConnection.buttonLabel}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={connectingEnvironmentId !== null}
              onClick={() => void connectEnvironment(environment)}
            >
              {connectingEnvironmentId === environment.environmentId ? "Connecting…" : "Connect"}
            </Button>
          )}
        </div>
      </div>
    );
  });
}
