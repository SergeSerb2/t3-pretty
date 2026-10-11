import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";

/**
 * Reports whether the route-local projections can still yield the requested
 * thread. Explicit terminal outcomes win over unrelated synchronization.
 */
export function threadRouteIsHydrating(input: {
  readonly isLoadingConnections: boolean;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly shellStatus: EnvironmentShellStatus;
  readonly shellHasError: boolean;
  readonly detailStatus: EnvironmentThreadStatus;
  readonly detailHasError: boolean;
  readonly hasShellSnapshot?: boolean;
  readonly hasDetail?: boolean;
}): boolean {
  if (input.detailStatus === "deleted" || input.shellHasError || input.detailHasError) {
    return false;
  }
  // HTTP detail or a cached shell row is enough to leave the opening screen.
  // Remotes that never reach `live` (interrupted subscribe) used to spin here.
  if (input.hasDetail === true) {
    return false;
  }
  if (input.isLoadingConnections) {
    return true;
  }
  if (
    input.connectionState === "available" ||
    input.connectionState === "offline" ||
    input.connectionState === "error"
  ) {
    return false;
  }
  if (
    input.hasShellSnapshot === true &&
    (input.shellStatus === "cached" || input.shellStatus === "synchronizing")
  ) {
    return input.detailStatus === "synchronizing" || input.detailStatus === "empty";
  }
  return (
    input.connectionState === "connecting" ||
    input.connectionState === "reconnecting" ||
    input.shellStatus === "synchronizing" ||
    (input.connectionState === "connected" && input.shellStatus === "empty") ||
    input.detailStatus === "synchronizing" ||
    (input.connectionState === "connected" && input.detailStatus === "empty")
  );
}
