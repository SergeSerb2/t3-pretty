import type { ConnectionTarget } from "@t3tools/client-runtime/connection";
import {
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  type DesktopBridge,
  type DesktopEnvironmentBootstrap,
} from "@t3tools/contracts";

/**
 * Desktop-local secondary backends (e.g. a parallel WSL backend) are registered
 * by the connection platform source as bearer connections whose id carries this
 * prefix. It is the renderer's single signal that an environment is a
 * host-managed local backend rather than a user-saved remote, SSH, or relay
 * environment.
 *
 * Keep this the one source of truth: the producer (`connection/platform.ts`)
 * mints ids via {@link desktopLocalConnectionId} and every consumer classifies
 * via {@link isDesktopLocalConnectionTarget}, so the convention can never drift
 * between the two.
 */
export const DESKTOP_LOCAL_CONNECTION_ID_PREFIX = "local:";

export function desktopLocalConnectionId(backendId: string): string {
  return `${DESKTOP_LOCAL_CONNECTION_ID_PREFIX}${backendId}`;
}

export function isDesktopLocalConnectionTarget(
  target: ConnectionTarget,
): target is Extract<ConnectionTarget, { readonly _tag: "BearerConnectionTarget" }> {
  return (
    target._tag === "BearerConnectionTarget" &&
    target.connectionId.startsWith(DESKTOP_LOCAL_CONNECTION_ID_PREFIX)
  );
}

export function desktopLocalBackendId(target: ConnectionTarget): string | null {
  return isDesktopLocalConnectionTarget(target)
    ? target.connectionId.slice(DESKTOP_LOCAL_CONNECTION_ID_PREFIX.length)
    : null;
}

export type DesktopSecondaryBootstrapsRead =
  | {
      readonly _tag: "Success";
      readonly bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>;
    }
  | {
      readonly _tag: "Failure";
      readonly cause: unknown;
    };

export interface DesktopSecondaryBootstrapsReader {
  readonly readResult: () => Promise<DesktopSecondaryBootstrapsRead>;
  readonly readSnapshot: () => ReadonlyArray<DesktopEnvironmentBootstrap>;
  readonly subscribe: (
    listener: (bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>) => void,
  ) => () => void;
}

interface DesktopSecondaryBootstrapsReaderOptions {
  readonly readTimeoutMs?: number;
}

/**
 * Build a topology reader whose snapshot advances only after successful bridge
 * reads. A successful empty read is authoritative; a thrown read preserves the
 * previous snapshot so UI consumers cannot temporarily disagree with the
 * platform's retained registrations.
 */
export function createDesktopSecondaryBootstrapsReader(
  resolveBridge: () => Pick<DesktopBridge, "getLocalEnvironmentBootstraps"> | undefined,
  options: DesktopSecondaryBootstrapsReaderOptions = {},
): DesktopSecondaryBootstrapsReader {
  const readTimeoutMs = options.readTimeoutMs ?? 5_000;
  let snapshot: ReadonlyArray<DesktopEnvironmentBootstrap> = [];
  let inFlight:
    | {
        readonly read: DesktopBridge["getLocalEnvironmentBootstraps"];
        readonly promise: Promise<DesktopSecondaryBootstrapsRead>;
      }
    | undefined;
  let readGeneration = 0;
  const listeners = new Set<(bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>) => void>();

  const commit = (bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>) => {
    snapshot = bootstraps.filter((entry) => entry.id !== PRIMARY_LOCAL_ENVIRONMENT_ID);
    for (const listener of listeners) {
      listener(snapshot);
    }
    return snapshot;
  };

  const readResult = (): Promise<DesktopSecondaryBootstrapsRead> => {
    const bridge = resolveBridge();
    if (bridge === undefined) {
      readGeneration += 1;
      inFlight = undefined;
      return Promise.resolve({ _tag: "Success", bootstraps: commit([]) });
    }
    if (inFlight?.read === bridge.getLocalEnvironmentBootstraps) {
      return inFlight.promise;
    }
    // Selecting a different bridge read invalidates the older result even when
    // the replacement throws synchronously. Otherwise that stale async read
    // can settle later and resurrect topology from the bridge we replaced.
    const generation = ++readGeneration;
    inFlight = undefined;
    try {
      const result = bridge.getLocalEnvironmentBootstraps();
      if (Array.isArray(result)) {
        return Promise.resolve({ _tag: "Success", bootstraps: commit(result) });
      }
      const promise = new Promise<DesktopSecondaryBootstrapsRead>((resolve) => {
        const timeout = setTimeout(() => {
          if (generation === readGeneration) readGeneration += 1;
          resolve({
            _tag: "Failure",
            cause: new Error(`Desktop topology read timed out after ${readTimeoutMs}ms.`),
          });
        }, readTimeoutMs);
        void Promise.resolve(result).then(
          (bootstraps) => {
            clearTimeout(timeout);
            const next = generation === readGeneration ? commit(bootstraps) : snapshot;
            resolve({ _tag: "Success", bootstraps: next });
          },
          (cause) => {
            clearTimeout(timeout);
            resolve({ _tag: "Failure", cause });
          },
        );
      }).finally(() => {
        if (inFlight?.promise === promise) {
          inFlight = undefined;
        }
      });
      inFlight = { read: bridge.getLocalEnvironmentBootstraps, promise };
      return promise;
    } catch (cause) {
      return Promise.resolve({ _tag: "Failure", cause });
    }
  };

  return {
    readResult,
    readSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const desktopSecondaryBootstrapsReader = createDesktopSecondaryBootstrapsReader(
  () => window.desktopBridge,
);

/** Read the topology while preserving failures for platform cache policy. */
export function readDesktopSecondaryBootstrapsResult(): Promise<DesktopSecondaryBootstrapsRead> {
  return desktopSecondaryBootstrapsReader.readResult();
}

/** Read the latest successful topology snapshot for renderer consumers. */
export function readDesktopSecondaryBootstraps(): ReadonlyArray<DesktopEnvironmentBootstrap> {
  void desktopSecondaryBootstrapsReader.readResult();
  return desktopSecondaryBootstrapsReader.readSnapshot();
}

/** Notify renderer stores as soon as an async desktop topology read settles. */
export function subscribeDesktopSecondaryBootstraps(
  listener: (bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>) => void,
): () => void {
  return desktopSecondaryBootstrapsReader.subscribe(listener);
}
