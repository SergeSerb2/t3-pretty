/**
 * OAuth 2.1 client pieces for remote MCP servers, per the MCP authorization
 * spec (2025-06-18): RFC 9728 protected-resource discovery, RFC 8414 /
 * OpenID authorization-server metadata, RFC 7591 dynamic client
 * registration, PKCE (S256), RFC 8707 `resource`, and refresh.
 *
 * Stateless helpers over `HttpClient`; `AppsService` owns storage and flow.
 */
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/** MCP protocol version sent while probing an upstream for its auth challenge. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface AuthorizationServerMetadata {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string | undefined;
  readonly scopesSupported: ReadonlyArray<string>;
}

export interface AuthorizationDiscovery {
  readonly metadata: AuthorizationServerMetadata;
  /** RFC 8707 resource indicator: the PRM `resource` when published, else nothing. */
  readonly resource: string | undefined;
  /** Scopes the resource server advertises (PRM `scopes_supported`), else the AS's. */
  readonly scopesSupported: ReadonlyArray<string>;
}

const ProtectedResourceMetadata = Schema.Struct({
  resource: Schema.optional(Schema.String),
  authorization_servers: Schema.optional(Schema.Array(Schema.String)),
  scopes_supported: Schema.optional(Schema.Array(Schema.String)),
});

const RawAuthorizationServerMetadata = Schema.Struct({
  issuer: Schema.optional(Schema.String),
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  registration_endpoint: Schema.optional(Schema.String),
  scopes_supported: Schema.optional(Schema.Array(Schema.String)),
});

const ClientRegistrationResponse = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.optional(Schema.String),
});

export const OAuthTokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  scope: Schema.optional(Schema.String),
});
export type OAuthTokenResponse = typeof OAuthTokenResponse.Type;

const decodePrm = Schema.decodeUnknownOption(ProtectedResourceMetadata);
const decodeAsMetadata = Schema.decodeUnknownOption(RawAuthorizationServerMetadata);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export class AppOAuthError extends Schema.TaggedErrorClass<AppOAuthError>()("AppOAuthError", {
  step: Schema.Literals(["discover", "register", "exchange", "refresh"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const fetchJson = Effect.fn("apps.oauth.fetch_json")(function* (url: string) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* httpClient
    .get(url, { headers: { accept: "application/json" } })
    .pipe(Effect.option);
  if (Option.isNone(response) || response.value.status !== 200) return undefined;
  const json = yield* response.value.json.pipe(Effect.option);
  return Option.isSome(json) ? json.value : undefined;
});

/** Parse `resource_metadata="..."` out of a `WWW-Authenticate: Bearer …` header. */
export function resourceMetadataUrlFromChallenge(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /resource_metadata\s*=\s*"?([^",\s]+)"?/i.exec(header);
  return match?.[1];
}

/** Candidate RFC 9728 URLs for a resource, most specific first. */
export function protectedResourceMetadataUrls(resourceUrl: string): ReadonlyArray<string> {
  const url = new URL(resourceUrl);
  const path = url.pathname.replace(/\/+$/, "");
  return [
    ...(path ? [`${url.origin}/.well-known/oauth-protected-resource${path}`] : []),
    `${url.origin}/.well-known/oauth-protected-resource`,
  ];
}

/** Candidate metadata URLs for an issuer, per RFC 8414 §3.1 and OpenID Discovery. */
export function authorizationServerMetadataUrls(issuer: string): ReadonlyArray<string> {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/+$/, "");
  return [
    ...(path
      ? [
          `${url.origin}/.well-known/oauth-authorization-server${path}`,
          `${url.origin}/.well-known/openid-configuration${path}`,
          `${url.origin}${path}/.well-known/openid-configuration`,
        ]
      : []),
    `${url.origin}/.well-known/oauth-authorization-server`,
    `${url.origin}/.well-known/openid-configuration`,
  ];
}

const probeChallenge = Effect.fn("apps.oauth.probe_challenge")(function* (mcpUrl: string) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.post(mcpUrl).pipe(
    HttpClientRequest.setHeaders({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    }),
    HttpClientRequest.bodyText(
      encodeJson({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "T3 Code", version: "0" },
        },
      }),
      "application/json",
    ),
    httpClient.execute,
    Effect.option,
  );
  if (Option.isNone(response)) return undefined;
  return resourceMetadataUrlFromChallenge(response.value.headers["www-authenticate"]);
});

/**
 * Locate the authorization server for an MCP endpoint. Falls back to the
 * spec's default endpoints on the MCP origin when no metadata is published.
 */
export const discoverAuthorization = Effect.fn("apps.oauth.discover")(function* (mcpUrl: string) {
  const challengeUrl = yield* probeChallenge(mcpUrl);
  const prmCandidates = [
    ...(challengeUrl ? [challengeUrl] : []),
    ...protectedResourceMetadataUrls(mcpUrl),
  ];
  let prm: typeof ProtectedResourceMetadata.Type | undefined;
  for (const candidate of prmCandidates) {
    const decoded = decodePrm(yield* fetchJson(candidate));
    if (Option.isSome(decoded) && (decoded.value.authorization_servers?.length ?? 0) > 0) {
      prm = decoded.value;
      break;
    }
  }
  const issuer = prm?.authorization_servers?.[0] ?? new URL(mcpUrl).origin;
  let metadata: AuthorizationServerMetadata | undefined;
  for (const candidate of authorizationServerMetadataUrls(issuer)) {
    const decoded = decodeAsMetadata(yield* fetchJson(candidate));
    if (Option.isSome(decoded)) {
      metadata = {
        issuer: decoded.value.issuer ?? issuer,
        authorizationEndpoint: decoded.value.authorization_endpoint,
        tokenEndpoint: decoded.value.token_endpoint,
        registrationEndpoint: decoded.value.registration_endpoint,
        scopesSupported: decoded.value.scopes_supported ?? [],
      };
      break;
    }
  }
  if (!metadata) {
    const origin = new URL(issuer).origin;
    metadata = {
      issuer,
      authorizationEndpoint: `${origin}/authorize`,
      tokenEndpoint: `${origin}/token`,
      registrationEndpoint: `${origin}/register`,
      scopesSupported: [],
    };
  }
  return {
    metadata,
    resource: prm?.resource,
    scopesSupported:
      prm?.scopes_supported && prm.scopes_supported.length > 0
        ? prm.scopes_supported
        : metadata.scopesSupported,
  } satisfies AuthorizationDiscovery;
});

export const registerClient = Effect.fn("apps.oauth.register")(function* (input: {
  readonly registrationEndpoint: string;
  readonly redirectUri: string;
  readonly scope: string | undefined;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.post(input.registrationEndpoint).pipe(
    HttpClientRequest.setHeaders({ accept: "application/json" }),
    HttpClientRequest.bodyText(
      encodeJson({
        client_name: "T3 Code",
        client_uri: "https://t3.codes",
        redirect_uris: [input.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        ...(input.scope ? { scope: input.scope } : {}),
      }),
      "application/json",
    ),
    httpClient.execute,
    Effect.mapError(
      (cause) =>
        new AppOAuthError({
          step: "register",
          message: "Could not reach the authorization server to register a client.",
          cause,
        }),
    ),
  );
  if (response.status < 200 || response.status >= 300) {
    const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
    return yield* new AppOAuthError({
      step: "register",
      message: `Dynamic client registration failed (${response.status}): ${body.slice(0, 300)}`,
    });
  }
  const registration = yield* HttpClientResponse.schemaBodyJson(ClientRegistrationResponse)(
    response,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new AppOAuthError({
          step: "register",
          message: "Dynamic client registration returned an unexpected response.",
          cause,
        }),
    ),
  );
  return { clientId: registration.client_id, clientSecret: registration.client_secret };
});

export const makePkce = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const verifier = Encoding.encodeBase64Url(yield* crypto.randomBytes(32).pipe(Effect.orDie));
  const challenge = Encoding.encodeBase64Url(
    yield* crypto.digest("SHA-256", new TextEncoder().encode(verifier)).pipe(Effect.orDie),
  );
  const state = Encoding.encodeBase64Url(yield* crypto.randomBytes(24).pipe(Effect.orDie));
  return { verifier, challenge, state };
});

export function buildAuthorizationUrl(input: {
  readonly authorizationEndpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state: string;
  readonly scope: string | undefined;
  readonly resource: string | undefined;
  readonly extraParams: Readonly<Record<string, string>> | undefined;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  if (input.scope) url.searchParams.set("scope", input.scope);
  if (input.resource) url.searchParams.set("resource", input.resource);
  for (const [key, value] of Object.entries(input.extraParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

const postTokenRequest = (
  step: "exchange" | "refresh",
  tokenEndpoint: string,
  params: Record<string, string>,
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* HttpClientRequest.post(tokenEndpoint).pipe(
      // GitHub answers form-encoded unless asked for JSON.
      HttpClientRequest.setHeaders({ accept: "application/json" }),
      HttpClientRequest.bodyUrlParams(params),
      httpClient.execute,
      Effect.mapError(
        (cause) =>
          new AppOAuthError({ step, message: "Could not reach the token endpoint.", cause }),
      ),
    );
    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      return yield* new AppOAuthError({
        step,
        message: `Token request failed (${response.status}): ${body.slice(0, 300)}`,
      });
    }
    return yield* HttpClientResponse.schemaBodyJson(OAuthTokenResponse)(response).pipe(
      Effect.mapError(
        (cause) =>
          new AppOAuthError({
            step,
            message: "Token endpoint returned an unexpected response.",
            cause,
          }),
      ),
    );
  });

export const exchangeAuthorizationCode = (input: {
  readonly tokenEndpoint: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly codeVerifier: string;
  readonly resource: string | undefined;
}) =>
  postTokenRequest("exchange", input.tokenEndpoint, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
    ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
    ...(input.resource ? { resource: input.resource } : {}),
  });

export const refreshAccessToken = (input: {
  readonly tokenEndpoint: string;
  readonly refreshToken: string;
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly resource: string | undefined;
}) =>
  postTokenRequest("refresh", input.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
    ...(input.resource ? { resource: input.resource } : {}),
  });

/** `expires_in` arrives as a number or numeric string; absent means non-expiring. */
export function tokenExpiryEpochMs(response: OAuthTokenResponse, now: number): number | null {
  const seconds = Number(response.expires_in);
  return Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1_000 : null;
}
