import {
  type EnvironmentServerConfigSnapshot,
  type ServerConfig,
  WS_METHODS,
} from "@t3tools/contracts";
import { serverConfigDigest } from "@t3tools/shared/serverConfigDigest";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";
import { HttpClient } from "effect/unstable/http";

import { makeWsRpcProtocolClient, type WsRpcProtocolClient } from "./protocol.ts";
import type {
  ConnectionAttemptError,
  ConnectionTransientError,
  PreparedConnection,
} from "../connection/model.ts";
import {
  ConnectionBlockedError,
  ConnectionTransientError as ConnectionTransientErrorClass,
} from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { fetchEnvironmentServerConfig } from "./serverConfigHttp.ts";

const SOCKET_OPEN_TIMEOUT = "15 seconds";

export interface RpcSession {
  readonly client: WsRpcProtocolClient;
  readonly initialConfig: Effect.Effect<ServerConfig, ConnectionAttemptError>;
  readonly initialConfigSnapshot?: Effect.Effect<
    EnvironmentServerConfigSnapshot,
    ConnectionAttemptError
  >;
  readonly ready: Effect.Effect<void, ConnectionAttemptError>;
  readonly probe: Effect.Effect<void, ConnectionAttemptError>;
  readonly closed: Effect.Effect<never, ConnectionTransientError>;
}

export class RpcSessionFactory extends Context.Service<
  RpcSessionFactory,
  {
    readonly connect: (
      connection: PreparedConnection,
    ) => Effect.Effect<RpcSession, ConnectionAttemptError, Scope.Scope>;
  }
>()("@t3tools/client-runtime/rpc/session/RpcSessionFactory") {}

type InitialConfigError = Effect.Error<
  ReturnType<WsRpcProtocolClient[typeof WS_METHODS.serverGetConfig]>
>;
type ProbeError = Effect.Error<ReturnType<WsRpcProtocolClient[typeof WS_METHODS.serverProbe]>>;

function mapSessionRpcError(error: InitialConfigError | ProbeError): ConnectionAttemptError {
  switch (error._tag) {
    case "EnvironmentAuthorizationError":
      return new ConnectionBlockedError({
        reason: "permission",
        detail: error.message,
      });
    case "KeybindingsConfigParseError":
    case "ServerSettingsError":
      return new ConnectionTransientErrorClass({
        reason: "remote-unavailable",
        detail: error.message,
      });
    case "RpcClientError":
      return new ConnectionTransientErrorClass({
        reason: "transport",
        detail: error.message,
      });
  }
}

export const make = Effect.gen(function* () {
  const webSocketConstructor = yield* Socket.WebSocketConstructor;
  const httpClient = yield* Effect.serviceOption(HttpClient.HttpClient);
  const dpopSigner = yield* Effect.serviceOption(ManagedRelayDpopSigner);

  const connect = Effect.fnUntraced(function* (connection: PreparedConnection) {
    yield* Effect.annotateCurrentSpan({
      "connection.environment.id": connection.environmentId,
    });

    const connected = yield* Deferred.make<void>();
    const disconnected = yield* Deferred.make<never, ConnectionTransientError>();
    const hooks = RpcClient.ConnectionHooks.of({
      onConnect: Deferred.succeed(connected, undefined).pipe(Effect.asVoid),
      onDisconnect: Deferred.isDone(connected).pipe(
        Effect.flatMap((wasConnected) =>
          Deferred.fail(
            disconnected,
            new ConnectionTransientErrorClass({
              reason: "transport",
              detail: wasConnected
                ? `${connection.label} disconnected.`
                : `${connection.label} could not establish a WebSocket connection.`,
            }),
          ),
        ),
        Effect.asVoid,
      ),
    });
    const socketLayer = Socket.layerWebSocket(connection.socketUrl, {
      openTimeout: SOCKET_OPEN_TIMEOUT,
    }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, webSocketConstructor)));
    const protocolLayer = Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
      }),
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          socketLayer,
          RpcSerialization.layerJson,
          Layer.succeed(RpcClient.ConnectionHooks, hooks),
        ),
      ),
    );
    const protocolContext = yield* Layer.build(protocolLayer).pipe(
      Effect.withSpan("environment.websocket.connect"),
    );
    const client = yield* makeWsRpcProtocolClient.pipe(Effect.provide(protocolContext));
    // The WebSocket fallback must not race the handshake: a request queued on
    // a socket that never opens would only surface as a much later timeout.
    const websocketConfig = Deferred.await(connected).pipe(
      Effect.andThen(client[WS_METHODS.serverGetConfig]({})),
      Effect.map((config) => ({ config, digest: serverConfigDigest(config) })),
      Effect.mapError(mapSessionRpcError),
      Effect.tap((snapshot) =>
        Effect.annotateCurrentSpan({
          "server.config.decodedBytes": JSON.stringify(snapshot.config).length,
          "server.config.transport": "websocket",
        }),
      ),
    );
    const initialConfigSnapshot = yield* Effect.cached(
      (Option.isSome(httpClient)
        ? fetchEnvironmentServerConfig({
            prepared: connection,
            signer: dpopSigner,
          }).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient.value),
            Effect.tap((snapshot) =>
              Effect.annotateCurrentSpan({
                "server.config.decodedBytes": JSON.stringify(snapshot.config).length,
                "server.config.transport": "http",
              }),
            ),
            Effect.catchCause((cause) =>
              Effect.logDebug(
                "Could not load initial server configuration over HTTP; using WebSocket compatibility fallback.",
                { cause: Cause.pretty(cause) },
              ).pipe(Effect.andThen(websocketConfig)),
            ),
          )
        : websocketConfig
      ).pipe(Effect.withSpan("environment.initialSync")),
    );
    const initialConfig = initialConfigSnapshot.pipe(Effect.map((snapshot) => snapshot.config));
    const probe = initialConfig.pipe(
      Effect.flatMap((config) =>
        (config.environment.capabilities.connectionProbe === true
          ? client[WS_METHODS.serverProbe]({})
          : client[WS_METHODS.serverGetConfig]({})
        ).pipe(Effect.mapError(mapSessionRpcError)),
      ),
      Effect.asVoid,
      Effect.withSpan("clientRuntime.connection.rpcSession.probe"),
    );

    return {
      client,
      initialConfig,
      initialConfigSnapshot,
      // The initial config travels over HTTP, so it is fetched while the
      // WebSocket handshake is still in flight instead of after it: one fewer
      // sequential round trip on every (re)connect.
      ready: Effect.all([Deferred.await(connected), initialConfig], {
        concurrency: "unbounded",
      }).pipe(Effect.asVoid, Effect.raceFirst(Deferred.await(disconnected))),
      probe,
      closed: Deferred.await(disconnected),
    } satisfies RpcSession;
  });

  return RpcSessionFactory.of({ connect });
});

export const layer = Layer.effect(RpcSessionFactory, make);
