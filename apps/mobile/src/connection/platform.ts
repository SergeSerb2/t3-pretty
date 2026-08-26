import {
  ClientPresentation,
  CloudSession,
  EnvironmentOwnedDataCleanup,
  PlatformConnectionSource,
  PrimaryEnvironmentAuth,
  RelayDeviceIdentity,
  SshEnvironmentGateway,
} from "@t3tools/client-runtime/platform";
import {
  ConnectionBlockedError,
  ConnectionTransientError,
  Connectivity,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import { managedRelayAccountChanges, managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import { AuthStandardClientScopes } from "@t3tools/contracts";
import { SURGE_CODE_ACCOUNT_NAME, SURGE_CONNECT_NAME } from "@t3tools/shared/connectBranding";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import Constants from "expo-constants";
import * as Network from "expo-network";
import { AppState } from "react-native";

import { authClientMetadata } from "../lib/authClientMetadata";
import * as Runtime from "../lib/runtime";
import * as MobileStorage from "../persistence/mobile-storage";
import { appAtomRegistry } from "../state/atom-registry";
import { clearThreadOutboxEnvironment } from "../state/thread-outbox";
import { clearComposerDraftsEnvironment } from "../state/use-composer-drafts";
import { mobileApplicationActiveWakeup } from "./app-state-wakeups";
import { connectionStorageLayer } from "./storage";

const MOBILE_NATIVE_OPERATION_TIMEOUT_MS = 10_000;
const MOBILE_ENVIRONMENT_CLEANUP_TIMEOUT_MS = 30_000;

function networkStatus(state: Network.NetworkState): "unknown" | "offline" | "online" {
  if (state.isConnected === false) {
    return "offline";
  }
  if (state.isConnected === true) {
    return "online";
  }
  return "unknown";
}

const readNetworkStatus = Effect.tryPromise({
  try: () => Network.getNetworkStateAsync(),
  catch: () => undefined,
}).pipe(
  Effect.map(networkStatus),
  Effect.orElseSucceed(() => "unknown" as const),
  Effect.timeoutOption(Duration.millis(MOBILE_NATIVE_OPERATION_TIMEOUT_MS)),
  Effect.map(Option.getOrElse(() => "unknown" as const)),
);

const connectivityLayer = Connectivity.layer({
  status: readNetworkStatus,
  changes: Stream.callback((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let active = true;
        let networkRevision = 0;
        let foregroundProbe: Promise<void> | null = null;
        const networkSubscription = Network.addNetworkStateListener((state) => {
          networkRevision += 1;
          Queue.offerUnsafe(queue, networkStatus(state));
        });
        // Re-query on resume so a network that came back while JS was
        // suspended is noticed. This one-shot uses a throwaway path monitor
        // that can time out and read as "offline" on a healthy network, so it
        // only ever restores connectivity; genuine loss still arrives through
        // the persistent listener above.
        const appStateSubscription = AppState.addEventListener("change", (state) => {
          if (state !== "active" || foregroundProbe !== null) {
            return;
          }
          const revisionAtStart = networkRevision;
          let timeout: ReturnType<typeof setTimeout> | null = null;
          const probe = Promise.race([
            Network.getNetworkStateAsync(),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new Error("Mobile foreground network probe timed out.")),
                MOBILE_NATIVE_OPERATION_TIMEOUT_MS,
              );
            }),
          ])
            .then((current) => {
              const status = networkStatus(current);
              if (active && status !== "offline") {
                Queue.offerUnsafe(queue, status);
              }
            })
            .catch(() => undefined)
            .finally(() => {
              if (timeout !== null) {
                clearTimeout(timeout);
              }
              if (foregroundProbe === probe) {
                foregroundProbe = null;
              }
            });
          foregroundProbe = probe;
        });
        return {
          close: () => {
            active = false;
            foregroundProbe = null;
            networkSubscription.remove();
            appStateSubscription.remove();
          },
        };
      }),
      ({ close }) => Effect.sync(close),
    ).pipe(Effect.asVoid),
  ),
});

const wakeupsLayer = Wakeups.layer({
  changes: Stream.merge(
    Stream.callback<"application-active-probe" | "application-active-reconnect">((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          let backgroundedAtMs = AppState.currentState === "background" ? Date.now() : null;
          return AppState.addEventListener("change", (state) => {
            if (state === "background") {
              backgroundedAtMs = Date.now();
              return;
            }
            // Only a stint in the background can hurt a socket. An
            // inactive→active blip (Control Center, notification shade, a
            // permission sheet) never suspended the process, so it wakes
            // nothing.
            if (state === "active" && backgroundedAtMs !== null) {
              Queue.offerUnsafe(queue, mobileApplicationActiveWakeup(backgroundedAtMs, Date.now()));
              backgroundedAtMs = null;
            }
          });
        }),
        (subscription) => Effect.sync(() => subscription.remove()),
      ).pipe(Effect.asVoid),
    ),
    managedRelayAccountChanges(appAtomRegistry).pipe(
      Stream.map(() => "credentials-changed" as const),
    ),
  ),
});

const capabilitiesLayer = Layer.effectContext(
  Effect.gen(function* () {
    const storage = yield* MobileStorage.MobileStorage;
    return Context.make(
      CloudSession,
      CloudSession.of({
        clerkToken: Effect.gen(function* () {
          const session = appAtomRegistry.get(managedRelaySessionAtom);
          if (session === null) {
            return yield* new ConnectionBlockedError({
              reason: "authentication",
              detail: `Sign in to ${SURGE_CODE_ACCOUNT_NAME} to connect this environment through ${SURGE_CONNECT_NAME}.`,
            });
          }
          const token = yield* session.readClerkToken().pipe(
            Effect.mapError(
              (error) =>
                new ConnectionTransientError({
                  reason: "network",
                  detail: error.message,
                }),
            ),
            Effect.timeoutOption(Duration.millis(MOBILE_NATIVE_OPERATION_TIMEOUT_MS)),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    new ConnectionTransientError({
                      reason: "network",
                      detail: `Obtaining the ${SURGE_CONNECT_NAME} session timed out.`,
                    }),
                  ),
                onSome: Effect.succeed,
              }),
            ),
          );
          if (token === null) {
            return yield* new ConnectionBlockedError({
              reason: "authentication",
              detail: `The ${SURGE_CONNECT_NAME} session is unavailable.`,
            });
          }
          return token;
        }),
      }),
    ).pipe(
      Context.add(
        PrimaryEnvironmentAuth,
        PrimaryEnvironmentAuth.of({ bearerToken: Effect.succeed(Option.none()) }),
      ),
      Context.add(
        RelayDeviceIdentity,
        RelayDeviceIdentity.of({
          deviceId: storage.loadOrCreateAgentAwarenessDeviceId.pipe(
            Effect.mapError(
              (cause) =>
                new ConnectionTransientError({
                  reason: "remote-unavailable",
                  detail: `Could not load the mobile device identity: ${String(cause)}`,
                }),
            ),
            Effect.timeoutOption(Duration.millis(MOBILE_NATIVE_OPERATION_TIMEOUT_MS)),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    new ConnectionTransientError({
                      reason: "remote-unavailable",
                      detail: "Loading the mobile device identity timed out.",
                    }),
                  ),
                onSome: (deviceId) => Effect.succeed(Option.some(deviceId)),
              }),
            ),
          ),
        }),
      ),
      Context.add(
        ClientPresentation,
        ClientPresentation.of({
          metadata: authClientMetadata(Constants.expoConfig?.version),
          scopes: AuthStandardClientScopes,
        }),
      ),
      Context.add(
        SshEnvironmentGateway,
        SshEnvironmentGateway.of({
          provision: () =>
            Effect.fail(
              new ConnectionBlockedError({
                reason: "unsupported",
                detail: "SSH environments are only available in the desktop app.",
              }),
            ),
          prepare: () =>
            Effect.fail(
              new ConnectionBlockedError({
                reason: "unsupported",
                detail: "SSH environments are only available in the desktop app.",
              }),
            ),
          disconnect: () => Effect.void,
        }),
      ),
    );
  }),
);

const platformConnectionSourceLayer = Layer.succeed(
  PlatformConnectionSource,
  PlatformConnectionSource.of({
    registrations: Stream.empty,
  }),
);

const providedConnectionStorageLayer = connectionStorageLayer.pipe(
  Layer.provide(Runtime.runtimeContextLayer),
);
const providedCapabilitiesLayer = capabilitiesLayer.pipe(
  Layer.provide(Runtime.runtimeContextLayer),
);

function cleanupEnvironmentResource(
  environmentId: string,
  resource: string,
  cleanup: () => Promise<void>,
) {
  return Effect.tryPromise({
    try: cleanup,
    catch: (cause) => cause,
  }).pipe(
    Effect.timeoutOption(Duration.millis(MOBILE_ENVIRONMENT_CLEANUP_TIMEOUT_MS)),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.logWarning("Mobile environment-owned data cleanup timed out.", {
            environmentId,
            resource,
          }),
        onSome: Effect.succeed,
      }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Could not clear mobile environment-owned data.", {
        environmentId,
        resource,
        cause,
      }),
    ),
  );
}

const environmentOwnedDataCleanupLayer = Layer.succeed(
  EnvironmentOwnedDataCleanup,
  EnvironmentOwnedDataCleanup.of({
    clear: (environmentId) =>
      Effect.all(
        [
          cleanupEnvironmentResource(environmentId, "thread outbox", () =>
            clearThreadOutboxEnvironment(environmentId),
          ),
          cleanupEnvironmentResource(environmentId, "composer drafts", () =>
            clearComposerDraftsEnvironment(environmentId),
          ),
        ],
        { concurrency: "unbounded", discard: true },
      ),
  }),
);

type ConnectionPlatformLayerSource =
  | typeof providedConnectionStorageLayer
  | typeof Runtime.runtimeContextLayer
  | typeof connectivityLayer
  | typeof wakeupsLayer
  | typeof providedCapabilitiesLayer
  | typeof platformConnectionSourceLayer
  | typeof environmentOwnedDataCleanupLayer;

export const connectionPlatformLayer: Layer.Layer<
  Layer.Success<ConnectionPlatformLayerSource>,
  Layer.Error<ConnectionPlatformLayerSource>,
  Layer.Services<ConnectionPlatformLayerSource>
> = Layer.mergeAll(
  providedConnectionStorageLayer,
  Runtime.runtimeContextLayer,
  connectivityLayer,
  wakeupsLayer,
  providedCapabilitiesLayer,
  platformConnectionSourceLayer,
  environmentOwnedDataCleanupLayer,
);
