/**
 * Apps: connection records live in `ServerSettings.apps` (server-written),
 * credentials live in the secret store, one JSON blob per connection. The
 * service is the only writer of both, serialized by one mutex, so a settings
 * read-modify-write never races another app operation.
 */
import {
  type AppConnection,
  type AppConnectionId,
  type AppConnectionInput,
  type AppsAuthorizeInput,
  type AppsAuthorizeResult,
  AppsError,
  type AppsSetOAuthClientInput,
  type AppsTestResult,
  findAppCatalogEntry,
  findAppOAuthClientFamily,
} from "@t3tools/contracts";
import type { AppsSettings } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AppOAuth from "./AppOAuth.ts";

export const APPS_OAUTH_CALLBACK_PATH = "/api/apps/oauth/callback";
const PENDING_AUTHORIZATION_TTL_MS = 10 * 60_000;
const REFRESH_EARLY_MS = 60_000;

const StoredClient = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
  tokenEndpoint: Schema.String,
  redirectUri: Schema.String,
  registrationEndpoint: Schema.optional(Schema.String),
});

const StoredToken = Schema.Struct({
  kind: Schema.Literals(["oauth", "static"]),
  accessToken: Schema.String,
  refreshToken: Schema.optional(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  resource: Schema.optional(Schema.String),
});

const StoredCredential = Schema.Struct({
  client: Schema.optional(StoredClient),
  token: Schema.optional(StoredToken),
});
type StoredCredential = typeof StoredCredential.Type;

const StoredCredentialJson = Schema.fromJsonString(StoredCredential);
const decodeStoredCredential = Schema.decodeUnknownOption(StoredCredentialJson);
const encodeStoredCredential = Schema.encodeSync(StoredCredentialJson);

interface PendingAuthorization {
  readonly connectionId: AppConnectionId;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly resource: string | undefined;
  readonly createdAt: number;
}

export interface UpstreamTarget {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface CallbackOutcome {
  readonly ok: boolean;
  readonly connectionName: string | undefined;
  readonly message: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const UnknownJson = Schema.fromJsonString(Schema.Unknown);
const decodeUnknownJson = Schema.decodeUnknownOption(UnknownJson);
const encodeUnknownJson = Schema.encodeSync(UnknownJson);

const credentialSecretName = (connectionId: string) =>
  `apps-${Buffer.from(connectionId, "utf8").toString("base64url")}`;
const oauthClientSecretName = (family: string) =>
  `apps-oauth-client-${Buffer.from(family, "utf8").toString("base64url")}`;

export function appsCallbackRedirectUri(callbackOrigin: string): string {
  return new URL(APPS_OAUTH_CALLBACK_PATH, callbackOrigin).toString();
}

function upstreamHeaders(
  connection: AppConnection,
  token: string | undefined,
): Readonly<Record<string, string>> {
  if (token === undefined) return {};
  const header = connection.auth === "token" ? connection.tokenHeader : "Authorization";
  return header.toLowerCase() === "authorization"
    ? { authorization: `Bearer ${token}` }
    : { [header.toLowerCase()]: token };
}

/** Attach rule shared with provider session prep: on, and credentialed when it needs to be. */
export function isAppAttachable(connection: AppConnection): boolean {
  return connection.enabled && (connection.auth === "none" || connection.authorizedAt !== null);
}

/** Minimal Streamable HTTP client: one JSON-RPC exchange, JSON or SSE reply. */
const mcpRequest = Effect.fn("apps.mcp_request")(function* (input: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly sessionId: string | undefined;
  readonly body: unknown;
  readonly expectResult: boolean;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.post(input.url).pipe(
    HttpClientRequest.setHeaders({
      ...input.headers,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": AppOAuth.MCP_PROTOCOL_VERSION,
      ...(input.sessionId ? { "mcp-session-id": input.sessionId } : {}),
    }),
    HttpClientRequest.bodyText(encodeUnknownJson(input.body), "application/json"),
    httpClient.execute,
    Effect.timeout(30_000),
  );
  const sessionId = response.headers["mcp-session-id"] ?? input.sessionId;
  if (response.status === 401 || response.status === 403) {
    return yield* new AppsError({
      operation: "test",
      message: `The server rejected the credential (${response.status}). Reconnect the app.`,
    });
  }
  if (response.status >= 300) {
    const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
    return yield* new AppsError({
      operation: "test",
      message: `MCP server answered ${response.status}: ${text.slice(0, 200)}`,
    });
  }
  if (!input.expectResult) return { sessionId, result: undefined as unknown };
  const text = yield* response.text;
  const contentType = response.headers["content-type"] ?? "";
  const payloads = contentType.includes("text/event-stream")
    ? text
        .split(/\r?\n\r?\n/)
        .map((chunk) =>
          chunk
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join(""),
        )
        .filter((data) => data.length > 0)
    : [text];
  for (const payload of payloads) {
    const parsed = decodeUnknownJson(payload);
    if (Option.isNone(parsed)) continue;
    const messages = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    for (const message of messages) {
      if (
        typeof message === "object" &&
        message !== null &&
        "id" in message &&
        (message as { id: unknown }).id === (input.body as { id: unknown }).id
      ) {
        if ("error" in message) {
          const error = (message as { error: { message?: string } }).error;
          return yield* new AppsError({
            operation: "test",
            message: `MCP error: ${error?.message ?? "unknown"}`,
          });
        }
        return { sessionId, result: (message as { result: unknown }).result };
      }
    }
  }
  return yield* new AppsError({
    operation: "test",
    message: "MCP server sent no response to the request.",
  });
});

export class AppsService extends Context.Service<
  AppsService,
  {
    readonly upsert: (input: AppConnectionInput) => Effect.Effect<void, AppsError>;
    readonly remove: (connectionId: AppConnectionId) => Effect.Effect<void, AppsError>;
    readonly authorize: (
      input: AppsAuthorizeInput,
    ) => Effect.Effect<AppsAuthorizeResult, AppsError>;
    readonly completeCallback: (input: {
      readonly state: string | null;
      readonly code: string | null;
      readonly error: string | null;
      readonly errorDescription: string | null;
    }) => Effect.Effect<CallbackOutcome>;
    readonly setToken: (input: {
      readonly connectionId: AppConnectionId;
      readonly token: string;
    }) => Effect.Effect<void, AppsError>;
    readonly setOAuthClient: (input: AppsSetOAuthClientInput) => Effect.Effect<void, AppsError>;
    readonly disconnect: (connectionId: AppConnectionId) => Effect.Effect<void, AppsError>;
    readonly test: (connectionId: AppConnectionId) => Effect.Effect<AppsTestResult, AppsError>;
    /**
     * Upstream URL + auth headers for a proxied call, refreshing an OAuth token
     * that is about to expire. `forceRefresh` retries once after an upstream 401.
     */
    readonly resolveUpstream: (
      connectionId: AppConnectionId,
      options?: { readonly forceRefresh?: boolean; readonly requireEnabled?: boolean },
    ) => Effect.Effect<UpstreamTarget, AppsError>;
    readonly recordError: (
      connectionId: AppConnectionId,
      message: string | null,
    ) => Effect.Effect<void>;
  }
>()("t3/apps/AppsService") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const crypto = yield* Crypto.Crypto;
  const mutex = yield* Semaphore.make(1);
  const refreshLocks = new Map<string, Semaphore.Semaphore>();
  const pending = new Map<string, PendingAuthorization>();

  const withHttp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, HttpClient.HttpClient, httpClient);
  const pkce = AppOAuth.makePkce.pipe(Effect.provideService(Crypto.Crypto, crypto));

  const fail = (
    operation: AppsError["operation"],
    message: string,
    connectionId?: AppConnectionId,
    cause?: unknown,
  ) =>
    new AppsError({
      operation,
      message,
      ...(connectionId ? { connectionId } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });

  const readSettings = (operation: AppsError["operation"]) =>
    settings.getSettings.pipe(
      Effect.mapError((cause) =>
        fail(operation, "Could not read server settings.", undefined, cause),
      ),
    );

  const writeApps = (
    operation: AppsError["operation"],
    update: (apps: AppsSettings) => AppsSettings,
  ) =>
    Effect.gen(function* () {
      const current = yield* readSettings(operation);
      yield* settings
        .updateSettings({ apps: update(current.apps) })
        .pipe(
          Effect.mapError((cause) =>
            fail(operation, "Could not write server settings.", undefined, cause),
          ),
        );
    });

  const patchConnection = (
    operation: AppsError["operation"],
    connectionId: AppConnectionId,
    patch: Partial<AppConnection>,
  ) =>
    writeApps(operation, (apps) => {
      const existing = apps.connections[connectionId];
      return existing
        ? {
            ...apps,
            connections: { ...apps.connections, [connectionId]: { ...existing, ...patch } },
          }
        : apps;
    });

  const requireConnection = (operation: AppsError["operation"], connectionId: AppConnectionId) =>
    readSettings(operation).pipe(
      Effect.flatMap((current) => {
        const connection = current.apps.connections[connectionId];
        return connection
          ? Effect.succeed({ connection, apps: current.apps })
          : Effect.fail(fail(operation, "Unknown app connection.", connectionId));
      }),
    );

  const readCredential = (connectionId: AppConnectionId) =>
    secrets.get(credentialSecretName(connectionId)).pipe(
      Effect.map((bytes) =>
        Option.isSome(bytes)
          ? decodeStoredCredential(textDecoder.decode(bytes.value)).pipe(Option.getOrUndefined)
          : undefined,
      ),
      Effect.orElseSucceed((): StoredCredential | undefined => undefined),
    );

  const writeCredential = (
    operation: AppsError["operation"],
    connectionId: AppConnectionId,
    credential: StoredCredential,
  ) =>
    secrets
      .set(
        credentialSecretName(connectionId),
        textEncoder.encode(encodeStoredCredential(credential)),
      )
      .pipe(
        Effect.mapError((cause) =>
          fail(operation, "Could not store the app credential.", connectionId, cause),
        ),
      );

  const removeCredential = (operation: AppsError["operation"], connectionId: AppConnectionId) =>
    secrets
      .remove(credentialSecretName(connectionId))
      .pipe(
        Effect.mapError((cause) =>
          fail(operation, "Could not remove the app credential.", connectionId, cause),
        ),
      );

  const upsert: AppsService["Service"]["upsert"] = (input) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* readSettings("upsert");
        const apps = current.apps;
        const existing = apps.connections[input.id];
        const duplicateSlug = Object.values(apps.connections).find(
          (connection) => connection.id !== input.id && connection.slug === input.slug,
        );
        if (duplicateSlug) {
          return yield* fail("upsert", `Another app already uses "@${input.slug}".`, input.id);
        }
        // Switching auth kind or endpoint invalidates whatever credential was
        // stored; the caller must connect again.
        const credentialStillValid =
          existing !== undefined && existing.auth === input.auth && existing.url === input.url;
        const now = yield* Clock.currentTimeMillis;
        const next: AppConnection = {
          ...input,
          createdAt: existing?.createdAt ?? now,
          authorizedAt: credentialStillValid ? existing.authorizedAt : null,
          lastError: credentialStillValid ? existing.lastError : null,
        };
        yield* settings
          .updateSettings({
            apps: { ...apps, connections: { ...apps.connections, [input.id]: next } },
          })
          .pipe(
            Effect.mapError((cause) =>
              fail("upsert", "Could not write server settings.", input.id, cause),
            ),
          );
        if (existing && !credentialStillValid) {
          yield* removeCredential("upsert", input.id).pipe(Effect.ignore);
        }
      }),
    );

  const remove: AppsService["Service"]["remove"] = (connectionId) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        yield* writeApps("remove", (apps) => {
          const { [connectionId]: _removed, ...connections } = apps.connections;
          return { ...apps, connections };
        });
        yield* removeCredential("remove", connectionId).pipe(Effect.ignore);
      }),
    );

  const authorize: AppsService["Service"]["authorize"] = (input) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const { connection, apps } = yield* requireConnection("authorize", input.connectionId);
        if (connection.auth !== "oauth") {
          return yield* fail("authorize", "This app does not use OAuth.", connection.id);
        }
        const redirectUri = yield* Effect.try({
          try: () => {
            const origin = new URL(input.callbackOrigin);
            if (origin.protocol !== "http:" && origin.protocol !== "https:") throw new Error();
            return appsCallbackRedirectUri(origin.origin);
          },
          catch: () => fail("authorize", "Invalid callback origin.", connection.id),
        });
        const catalog = findAppCatalogEntry(connection.catalogId);
        const discovery = yield* withHttp(AppOAuth.discoverAuthorization(connection.url)).pipe(
          Effect.mapError((cause) =>
            fail(
              "authorize",
              "Could not discover the app's authorization server.",
              connection.id,
              cause,
            ),
          ),
        );
        const scope =
          connection.scopes ||
          catalog?.scopes ||
          (discovery.scopesSupported.length > 0 ? discovery.scopesSupported.join(" ") : undefined);

        // Client: bring-your-own for families without dynamic registration,
        // otherwise reuse a prior registration for this redirect URI, else register.
        const family = catalog?.oauthClientFamily;
        const stored = yield* readCredential(connection.id);
        let client: { clientId: string; clientSecret: string | undefined };
        if (family) {
          const configured = apps.oauthClients[family];
          if (!configured) {
            const familyName = findAppOAuthClientFamily(family)?.name ?? family;
            return yield* fail(
              "authorize",
              `Add your ${familyName} (Client ID and secret) in Settings → Apps before connecting.`,
              connection.id,
            );
          }
          const secret = yield* secrets
            .get(oauthClientSecretName(family))
            .pipe(Effect.orElseSucceed(() => Option.none<Uint8Array>()));
          client = {
            clientId: configured.clientId,
            clientSecret: Option.isSome(secret) ? textDecoder.decode(secret.value) : undefined,
          };
        } else if (
          stored?.client &&
          stored.client.redirectUri === redirectUri &&
          stored.client.tokenEndpoint === discovery.metadata.tokenEndpoint
        ) {
          client = { clientId: stored.client.clientId, clientSecret: stored.client.clientSecret };
        } else if (discovery.metadata.registrationEndpoint) {
          client = yield* withHttp(
            AppOAuth.registerClient({
              registrationEndpoint: discovery.metadata.registrationEndpoint,
              redirectUri,
              scope,
            }),
          ).pipe(
            Effect.mapError((cause) => fail("authorize", cause.message, connection.id, cause)),
          );
        } else {
          return yield* fail(
            "authorize",
            "This server does not support dynamic client registration. Connect with an API token instead.",
            connection.id,
          );
        }
        yield* writeCredential("authorize", connection.id, {
          ...stored,
          client: {
            clientId: client.clientId,
            ...(client.clientSecret ? { clientSecret: client.clientSecret } : {}),
            tokenEndpoint: discovery.metadata.tokenEndpoint,
            redirectUri,
            ...(discovery.metadata.registrationEndpoint
              ? { registrationEndpoint: discovery.metadata.registrationEndpoint }
              : {}),
          },
        });

        const challenge = yield* pkce;
        const now = yield* Clock.currentTimeMillis;
        for (const [state, entry] of pending) {
          if (now - entry.createdAt > PENDING_AUTHORIZATION_TTL_MS) pending.delete(state);
        }
        pending.set(challenge.state, {
          connectionId: connection.id,
          codeVerifier: challenge.verifier,
          redirectUri,
          tokenEndpoint: discovery.metadata.tokenEndpoint,
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          resource: discovery.resource,
          createdAt: now,
        });
        return {
          authorizationUrl: AppOAuth.buildAuthorizationUrl({
            authorizationEndpoint: discovery.metadata.authorizationEndpoint,
            clientId: client.clientId,
            redirectUri,
            codeChallenge: challenge.challenge,
            state: challenge.state,
            scope,
            resource: discovery.resource,
            extraParams: catalog?.authorizeParams,
          }),
        };
      }),
    );

  const completeCallback: AppsService["Service"]["completeCallback"] = (input) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const entry = input.state ? pending.get(input.state) : undefined;
        if (!entry) {
          return {
            ok: false,
            connectionName: undefined,
            message:
              "This authorization link is unknown or has expired. Start again from Settings → Apps.",
          };
        }
        pending.delete(input.state!);
        const now = yield* Clock.currentTimeMillis;
        const current = yield* settings.getSettings.pipe(Effect.option);
        const connection = Option.isSome(current)
          ? current.value.apps.connections[entry.connectionId]
          : undefined;
        const connectionName = connection?.name;
        if (now - entry.createdAt > PENDING_AUTHORIZATION_TTL_MS) {
          return { ok: false, connectionName, message: "This authorization link has expired." };
        }
        if (input.error || !input.code) {
          const message = `Authorization was not granted${
            input.errorDescription
              ? `: ${input.errorDescription}`
              : input.error
                ? ` (${input.error})`
                : "."
          }`;
          yield* patchConnection("callback", entry.connectionId, { lastError: message }).pipe(
            Effect.ignore,
          );
          return { ok: false, connectionName, message };
        }
        const exchanged = yield* withHttp(
          AppOAuth.exchangeAuthorizationCode({
            tokenEndpoint: entry.tokenEndpoint,
            code: input.code,
            redirectUri: entry.redirectUri,
            clientId: entry.clientId,
            clientSecret: entry.clientSecret,
            codeVerifier: entry.codeVerifier,
            resource: entry.resource,
          }),
        ).pipe(Effect.result);
        if (Result.isFailure(exchanged)) {
          yield* patchConnection("callback", entry.connectionId, {
            lastError: exchanged.failure.message,
          }).pipe(Effect.ignore);
          return { ok: false, connectionName, message: exchanged.failure.message };
        }
        const stored = yield* readCredential(entry.connectionId);
        yield* writeCredential("callback", entry.connectionId, {
          ...stored,
          token: {
            kind: "oauth",
            accessToken: exchanged.success.access_token,
            ...(exchanged.success.refresh_token
              ? { refreshToken: exchanged.success.refresh_token }
              : {}),
            expiresAt: AppOAuth.tokenExpiryEpochMs(exchanged.success, now),
            ...(entry.resource ? { resource: entry.resource } : {}),
          },
        }).pipe(Effect.ignore);
        yield* patchConnection("callback", entry.connectionId, {
          authorizedAt: now,
          lastError: null,
        }).pipe(Effect.ignore);
        return { ok: true, connectionName, message: "Connected." };
      }),
    );

  const setToken: AppsService["Service"]["setToken"] = (input) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const { connection } = yield* requireConnection("set-token", input.connectionId);
        if (connection.auth !== "token") {
          return yield* fail("set-token", "This app does not use a token.", connection.id);
        }
        const now = yield* Clock.currentTimeMillis;
        yield* writeCredential("set-token", connection.id, {
          token: { kind: "static", accessToken: input.token, expiresAt: null },
        });
        yield* patchConnection("set-token", connection.id, { authorizedAt: now, lastError: null });
      }),
    );

  const setOAuthClient: AppsService["Service"]["setOAuthClient"] = (input) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const family = input.family;
        const clientId = input.clientId.trim();
        if (clientId.length === 0) {
          yield* secrets.remove(oauthClientSecretName(family)).pipe(Effect.ignore);
          yield* writeApps("set-oauth-client", (apps) => {
            const { [family]: _removed, ...oauthClients } = apps.oauthClients;
            return { ...apps, oauthClients };
          });
          return;
        }
        let hasClientSecret = yield* secrets.get(oauthClientSecretName(family)).pipe(
          Effect.map(Option.isSome),
          Effect.orElseSucceed(() => false),
        );
        if (input.clientSecret !== undefined) {
          if (input.clientSecret.length > 0) {
            yield* secrets
              .set(oauthClientSecretName(family), textEncoder.encode(input.clientSecret))
              .pipe(
                Effect.mapError((cause) =>
                  fail("set-oauth-client", "Could not store the client secret.", undefined, cause),
                ),
              );
            hasClientSecret = true;
          } else {
            yield* secrets.remove(oauthClientSecretName(family)).pipe(Effect.ignore);
            hasClientSecret = false;
          }
        }
        yield* writeApps("set-oauth-client", (apps) => ({
          ...apps,
          oauthClients: { ...apps.oauthClients, [family]: { clientId, hasClientSecret } },
        }));
      }),
    );

  const disconnect: AppsService["Service"]["disconnect"] = (connectionId) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        yield* requireConnection("disconnect", connectionId);
        yield* removeCredential("disconnect", connectionId).pipe(Effect.ignore);
        yield* patchConnection("disconnect", connectionId, { authorizedAt: null, lastError: null });
      }),
    );

  const recordError: AppsService["Service"]["recordError"] = (connectionId, message) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* settings.getSettings.pipe(Effect.option);
        const connection = Option.isSome(current)
          ? current.value.apps.connections[connectionId]
          : undefined;
        if (!connection || connection.lastError === message) return;
        yield* patchConnection("proxy", connectionId, { lastError: message }).pipe(Effect.ignore);
      }),
    );

  const refreshLock = (connectionId: string) =>
    Effect.gen(function* () {
      const existing = refreshLocks.get(connectionId);
      if (existing) return existing;
      const created = yield* Semaphore.make(1);
      refreshLocks.set(connectionId, created);
      return created;
    });

  const resolveUpstream: AppsService["Service"]["resolveUpstream"] = (connectionId, options) =>
    Effect.gen(function* () {
      const { connection } = yield* requireConnection("proxy", connectionId);
      if (options?.requireEnabled !== false && !connection.enabled) {
        return yield* fail("proxy", "This app is turned off.", connectionId);
      }
      if (connection.auth === "none") {
        return { url: connection.url, headers: {} } satisfies UpstreamTarget;
      }
      const lock = yield* refreshLock(connectionId);
      const token = yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const stored = yield* readCredential(connectionId);
          const current = stored?.token;
          if (!current) {
            return yield* fail("proxy", "This app is not connected.", connectionId);
          }
          if (current.kind === "static") return current.accessToken;
          const now = yield* Clock.currentTimeMillis;
          const expiring =
            options?.forceRefresh === true ||
            (current.expiresAt !== null && current.expiresAt - REFRESH_EARLY_MS <= now);
          if (!expiring) return current.accessToken;
          if (!current.refreshToken || !stored?.client) {
            return yield* fail(
              "proxy",
              "The app's access token expired and cannot be refreshed. Reconnect it.",
              connectionId,
            );
          }
          const refreshed = yield* withHttp(
            AppOAuth.refreshAccessToken({
              tokenEndpoint: stored.client.tokenEndpoint,
              refreshToken: current.refreshToken,
              clientId: stored.client.clientId,
              clientSecret: stored.client.clientSecret,
              resource: current.resource,
            }),
          ).pipe(Effect.mapError((cause) => fail("proxy", cause.message, connectionId, cause)));
          const nextToken = {
            ...current,
            accessToken: refreshed.access_token,
            ...(refreshed.refresh_token ? { refreshToken: refreshed.refresh_token } : {}),
            expiresAt: AppOAuth.tokenExpiryEpochMs(refreshed, now),
          };
          yield* writeCredential("proxy", connectionId, { ...stored, token: nextToken });
          return nextToken.accessToken;
        }),
      );
      return { url: connection.url, headers: upstreamHeaders(connection, token) };
    });

  const test: AppsService["Service"]["test"] = (connectionId) =>
    Effect.gen(function* () {
      const target = yield* resolveUpstream(connectionId, { requireEnabled: false }).pipe(
        Effect.mapError((error) => fail("test", error.message, connectionId, error.cause)),
      );
      const call = (sessionId: string | undefined, body: unknown, expectResult: boolean) =>
        withHttp(
          mcpRequest({ url: target.url, headers: target.headers, sessionId, body, expectResult }),
        ).pipe(
          Effect.catchTags({
            HttpClientError: (cause) =>
              Effect.fail(fail("test", "Could not reach the MCP server.", connectionId, cause)),
            TimeoutError: () =>
              Effect.fail(fail("test", "The MCP server did not answer in time.", connectionId)),
          }),
        );
      const initialized = yield* call(
        undefined,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: AppOAuth.MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "T3 Code", version: "0" },
          },
        },
        true,
      );
      const serverInfo = (initialized.result as { serverInfo?: { name?: string } } | undefined)
        ?.serverInfo;
      yield* call(
        initialized.sessionId,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        false,
      ).pipe(Effect.ignore);
      const listed = yield* call(
        initialized.sessionId,
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        true,
      );
      const tools = (
        (listed.result as { tools?: ReadonlyArray<{ name: string; description?: string }> })
          ?.tools ?? []
      ).map((tool) => ({ name: tool.name, description: tool.description ?? null }));
      yield* recordError(connectionId, null);
      return { serverName: serverInfo?.name ?? null, tools } satisfies AppsTestResult;
    }).pipe(
      Effect.tapError((error) =>
        error.operation === "test" ? recordError(connectionId, error.message) : Effect.void,
      ),
    );

  return {
    upsert,
    remove,
    authorize,
    completeCallback,
    setToken,
    setOAuthClient,
    disconnect,
    test,
    resolveUpstream,
    recordError,
  } satisfies AppsService["Service"];
});

export const layer = Layer.effect(AppsService, make);
