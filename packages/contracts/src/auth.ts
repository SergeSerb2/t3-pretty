import * as Schema from "effect/Schema";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

import {
  AuthSessionId,
  ClientSurface,
  NonNegativeInt,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * Declares the server's overall authentication posture.
 *
 * This is a high-level policy label that tells clients how the environment is
 * expected to be accessed, not a transport detail and not an exhaustive list
 * of every accepted credential.
 *
 * Typical usage:
 * - rendered in auth/pairing UI so the user understands what kind of
 *   environment they are connecting to
 * - used by clients to decide whether silent desktop bootstrap is expected or
 *   whether an explicit pairing flow should be shown
 *
 * Meanings:
 * - `desktop-managed-local`: local desktop-managed environment with narrow
 *   trusted bootstrap, intended to avoid login prompts on the same machine
 * - `loopback-browser`: standalone local server intended for browser pairing on
 *   the same machine
 * - `remote-reachable`: environment intended to be reached from other devices
 *   or networks, where explicit pairing/auth is expected
 * - `unsafe-no-auth`: intentionally unauthenticated mode; this is an explicit
 *   unsafe escape hatch, not a normal deployment mode
 */
export const ServerAuthPolicy = Schema.Literals([
  "desktop-managed-local",
  "loopback-browser",
  "remote-reachable",
  "unsafe-no-auth",
]);
export type ServerAuthPolicy = typeof ServerAuthPolicy.Type;

/**
 * A credential type that can be exchanged for a real authenticated session.
 *
 * Bootstrap methods are for establishing trust at the start of a connection or
 * pairing flow. They are not the long-lived credential used for ordinary
 * authenticated HTTP / WebSocket traffic after pairing succeeds.
 *
 * Current methods:
 * - `desktop-bootstrap`: a trusted local desktop handoff, used so the desktop
 *   shell can pair the renderer without a login screen
 * - `one-time-token`: a short-lived pairing token, suitable for manual pairing
 *   flows such as `/pair?token=...`
 */
export const ServerAuthBootstrapMethod = Schema.Literals(["desktop-bootstrap", "one-time-token"]);
export type ServerAuthBootstrapMethod = typeof ServerAuthBootstrapMethod.Type;

/**
 * A credential type accepted for steady-state authenticated requests after a
 * client has already paired.
 *
 * These methods are used by the server-wide auth layer for privileged HTTP and
 * WebSocket access. They are distinct from bootstrap methods so clients can
 * reason clearly about "pair first, then use session auth".
 *
 * Current methods:
 * - `browser-session-cookie`: cookie-backed browser session, used by the web
 *   app after bootstrap/pairing
 * - `bearer-access-token`: scoped token suitable for non-cookie or
 *   non-browser clients
 * - `dpop-access-token`: scoped proof-of-possession token used by managed
 *   relay connections
 */
export const ServerAuthSessionMethod = Schema.Literals([
  "browser-session-cookie",
  "bearer-access-token",
  "dpop-access-token",
]);
export type ServerAuthSessionMethod = typeof ServerAuthSessionMethod.Type;

export const AuthOrchestrationReadScope = "orchestration:read" as const;
export const AuthOrchestrationOperateScope = "orchestration:operate" as const;
export const AuthTerminalOperateScope = "terminal:operate" as const;
export const AuthReviewWriteScope = "review:write" as const;
export const AuthAccessReadScope = "access:read" as const;
export const AuthAccessWriteScope = "access:write" as const;
export const AuthRelayReadScope = "relay:read" as const;
export const AuthRelayWriteScope = "relay:write" as const;
export const AUTH_ENVIRONMENT_SCOPE_MAX_COUNT = 8;
export const AUTH_CREDENTIAL_MAX_LENGTH = 16_384;
export const AUTH_IDENTIFIER_MAX_LENGTH = 256;
export const AUTH_SUBJECT_MAX_LENGTH = 256;
export const AUTH_CLIENT_LABEL_MAX_LENGTH = 256;
export const AUTH_CLIENT_IP_ADDRESS_MAX_LENGTH = 128;
export const AUTH_CLIENT_USER_AGENT_MAX_LENGTH = 4_096;
export const AUTH_CLIENT_OS_MAX_LENGTH = 256;
export const AUTH_CLIENT_BROWSER_MAX_LENGTH = 256;
export const AUTH_PROOF_KEY_THUMBPRINT_MAX_LENGTH = 256;
export const AUTH_OAUTH_SCOPE_MAX_LENGTH = 1_024;
export const AUTH_ERROR_MESSAGE_MAX_LENGTH = 4_096;
export const AUTH_ACCESS_PAIRING_LINK_MAX_COUNT = 1_024;
export const AUTH_ACCESS_CLIENT_SESSION_MAX_COUNT = 1_024;
export const AUTH_ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS = 2_147_483_647;
export const AuthEnvironmentScope = Schema.Literals([
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  AuthReviewWriteScope,
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
]);
export type AuthEnvironmentScope = typeof AuthEnvironmentScope.Type;
export const AuthEnvironmentScopes = Schema.Array(AuthEnvironmentScope).check(
  Schema.isMaxLength(AUTH_ENVIRONMENT_SCOPE_MAX_COUNT),
);
export type AuthEnvironmentScopes = typeof AuthEnvironmentScopes.Type;

export const AuthCredential = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTH_CREDENTIAL_MAX_LENGTH),
);
export const AuthIdentifier = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTH_IDENTIFIER_MAX_LENGTH),
);
export const AuthSubject = TrimmedNonEmptyString.check(Schema.isMaxLength(AUTH_SUBJECT_MAX_LENGTH));
export const AuthClientLabel = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTH_CLIENT_LABEL_MAX_LENGTH),
);
export const AuthClientIpAddress = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTH_CLIENT_IP_ADDRESS_MAX_LENGTH),
);
export const AuthClientUserAgent = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTH_CLIENT_USER_AGENT_MAX_LENGTH),
);
export const AuthClientOperatingSystem = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTH_CLIENT_OS_MAX_LENGTH),
);
export const AuthClientBrowser = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTH_CLIENT_BROWSER_MAX_LENGTH),
);
export const AuthProofKeyThumbprint = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTH_PROOF_KEY_THUMBPRINT_MAX_LENGTH),
);
export const AuthOAuthScope = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTH_OAUTH_SCOPE_MAX_LENGTH),
);
export const AuthErrorMessage = Schema.String.check(
  Schema.isMaxLength(AUTH_ERROR_MESSAGE_MAX_LENGTH),
);
export const AuthAccessSessionId = AuthSessionId.check(
  Schema.isMaxLength(AUTH_IDENTIFIER_MAX_LENGTH),
);
const AuthAccessTokenExpiresIn = NonNegativeInt.check(
  Schema.isLessThanOrEqualTo(AUTH_ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS),
);

export const AuthStandardClientScopes = [
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  AuthReviewWriteScope,
  AuthRelayReadScope,
] as const;
export const AuthAdministrativeScopes = [
  ...AuthStandardClientScopes,
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthRelayWriteScope,
] as const;

export const AuthTokenExchangeGrantType =
  "urn:ietf:params:oauth:grant-type:token-exchange" as const;
export const AuthAccessTokenType = "urn:ietf:params:oauth:token-type:access_token" as const;
export const AuthEnvironmentBootstrapTokenType =
  "urn:t3:params:oauth:token-type:environment-bootstrap" as const;

/**
 * Server-advertised auth capabilities for a specific execution environment.
 *
 * Clients should treat this as the authoritative description of how that
 * environment expects to be paired and how authenticated requests should be
 * made afterward.
 *
 * Field meanings:
 * - `policy`: high-level auth posture for the environment
 * - `bootstrapMethods`: pairing/bootstrap methods the server is currently
 *   willing to accept
 * - `sessionMethods`: authenticated request/session methods the server supports
 *   once pairing is complete
 * - `sessionCookieName`: cookie name clients should expect when
 *   `browser-session-cookie` is in use
 *
 * This descriptor is intentionally capability-oriented. It lets clients choose
 * the right UX without embedding server-specific auth logic or assuming a
 * single access method.
 */
export const ServerAuthDescriptor = Schema.Struct({
  policy: ServerAuthPolicy,
  bootstrapMethods: Schema.Array(ServerAuthBootstrapMethod).check(Schema.isMaxLength(2)),
  sessionMethods: Schema.Array(ServerAuthSessionMethod).check(Schema.isMaxLength(3)),
  sessionCookieName: AuthIdentifier,
});
export type ServerAuthDescriptor = typeof ServerAuthDescriptor.Type;

export const AuthBrowserSessionRequest = Schema.Struct({
  credential: AuthCredential,
});
export type AuthBrowserSessionRequest = typeof AuthBrowserSessionRequest.Type;

export const AuthBrowserSessionResult = Schema.Struct({
  authenticated: Schema.Literal(true),
  scopes: AuthEnvironmentScopes,
  sessionMethod: ServerAuthSessionMethod,
  expiresAt: Schema.DateTimeUtc,
});
export type AuthBrowserSessionResult = typeof AuthBrowserSessionResult.Type;

export const AuthClientMetadataDeviceType = Schema.Literals([
  "desktop",
  "mobile",
  "tablet",
  "bot",
  "unknown",
]);
export type AuthClientMetadataDeviceType = typeof AuthClientMetadataDeviceType.Type;

export const AuthClientPresentationMetadata = Schema.Struct({
  label: Schema.optionalKey(AuthClientLabel),
  deviceType: Schema.optionalKey(AuthClientMetadataDeviceType),
  os: Schema.optionalKey(AuthClientOperatingSystem),
  osMajorVersion: Schema.optionalKey(Schema.Int),
  deviceModel: Schema.optionalKey(TrimmedNonEmptyString),
  surface: Schema.optionalKey(ClientSurface),
  appVersion: Schema.optionalKey(TrimmedNonEmptyString),
});
export type AuthClientPresentationMetadata = typeof AuthClientPresentationMetadata.Type;

export const AuthTokenExchangeRequest = Schema.Struct({
  grant_type: Schema.Literal(AuthTokenExchangeGrantType),
  subject_token: AuthCredential,
  subject_token_type: Schema.Literal(AuthEnvironmentBootstrapTokenType),
  requested_token_type: Schema.Literal(AuthAccessTokenType),
  scope: Schema.optionalKey(AuthOAuthScope),
  client_label: Schema.optionalKey(AuthClientLabel),
  client_device_type: Schema.optionalKey(AuthClientMetadataDeviceType),
  client_os: Schema.optionalKey(AuthClientOperatingSystem),
}).pipe(HttpApiSchema.asFormUrlEncoded());
export type AuthTokenExchangeRequest = typeof AuthTokenExchangeRequest.Type;

export const AuthAccessTokenResult = Schema.Struct({
  access_token: AuthCredential,
  issued_token_type: Schema.Literal(AuthAccessTokenType),
  token_type: Schema.Literals(["Bearer", "DPoP"]),
  expires_in: AuthAccessTokenExpiresIn,
  scope: AuthOAuthScope,
});
export type AuthAccessTokenResult = typeof AuthAccessTokenResult.Type;

export const AuthWebSocketTicketResult = Schema.Struct({
  ticket: AuthCredential,
  expiresAt: Schema.DateTimeUtc,
});
export type AuthWebSocketTicketResult = typeof AuthWebSocketTicketResult.Type;

export const AuthPairingCredentialResult = Schema.Struct({
  id: AuthIdentifier,
  credential: AuthCredential,
  label: Schema.optionalKey(AuthClientLabel),
  expiresAt: Schema.DateTimeUtc,
});
export type AuthPairingCredentialResult = typeof AuthPairingCredentialResult.Type;

export const AuthPairingLink = Schema.Struct({
  id: AuthIdentifier,
  credential: AuthCredential,
  scopes: AuthEnvironmentScopes,
  subject: AuthSubject,
  label: Schema.optionalKey(AuthClientLabel),
  createdAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
});
export type AuthPairingLink = typeof AuthPairingLink.Type;

export const AuthClientMetadata = Schema.Struct({
  label: Schema.optionalKey(AuthClientLabel),
  ipAddress: Schema.optionalKey(AuthClientIpAddress),
  userAgent: Schema.optionalKey(AuthClientUserAgent),
  deviceType: AuthClientMetadataDeviceType,
  os: Schema.optionalKey(AuthClientOperatingSystem),
  browser: Schema.optionalKey(AuthClientBrowser),
});
export type AuthClientMetadata = typeof AuthClientMetadata.Type;

export const AuthClientSession = Schema.Struct({
  sessionId: AuthAccessSessionId,
  subject: AuthSubject,
  scopes: AuthEnvironmentScopes,
  method: ServerAuthSessionMethod,
  client: AuthClientMetadata,
  issuedAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  lastConnectedAt: Schema.NullOr(Schema.DateTimeUtc),
  connected: Schema.Boolean,
  current: Schema.Boolean,
});
export type AuthClientSession = typeof AuthClientSession.Type;

export const AuthPairingLinks = Schema.Array(AuthPairingLink).check(
  Schema.isMaxLength(AUTH_ACCESS_PAIRING_LINK_MAX_COUNT),
);
export type AuthPairingLinks = typeof AuthPairingLinks.Type;

export const AuthClientSessions = Schema.Array(AuthClientSession).check(
  Schema.isMaxLength(AUTH_ACCESS_CLIENT_SESSION_MAX_COUNT),
);
export type AuthClientSessions = typeof AuthClientSessions.Type;

export const AuthAccessSnapshot = Schema.Struct({
  pairingLinks: AuthPairingLinks,
  clientSessions: AuthClientSessions,
});
export type AuthAccessSnapshot = typeof AuthAccessSnapshot.Type;

export const AuthAccessStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  revision: NonNegativeInt,
  type: Schema.Literal("snapshot"),
  payload: AuthAccessSnapshot,
});
export type AuthAccessStreamSnapshotEvent = typeof AuthAccessStreamSnapshotEvent.Type;

export const AuthAccessStreamPairingLinkUpsertedEvent = Schema.Struct({
  version: Schema.Literal(1),
  revision: NonNegativeInt,
  type: Schema.Literal("pairingLinkUpserted"),
  payload: AuthPairingLink,
});
export type AuthAccessStreamPairingLinkUpsertedEvent =
  typeof AuthAccessStreamPairingLinkUpsertedEvent.Type;

export const AuthAccessStreamPairingLinkRemovedEvent = Schema.Struct({
  version: Schema.Literal(1),
  revision: NonNegativeInt,
  type: Schema.Literal("pairingLinkRemoved"),
  payload: Schema.Struct({
    id: AuthIdentifier,
  }),
});
export type AuthAccessStreamPairingLinkRemovedEvent =
  typeof AuthAccessStreamPairingLinkRemovedEvent.Type;

export class AuthAccessStreamError extends Schema.TaggedErrorClass<AuthAccessStreamError>()(
  "AuthAccessStreamError",
  {
    message: AuthErrorMessage,
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: { readonly message: string }) {
    super({ message: props.message.slice(0, AUTH_ERROR_MESSAGE_MAX_LENGTH) } as any);
  }
}

export class EnvironmentAuthorizationError extends Schema.TaggedErrorClass<EnvironmentAuthorizationError>()(
  "EnvironmentAuthorizationError",
  {
    message: AuthErrorMessage,
    requiredScope: AuthEnvironmentScope,
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: { readonly message: string; readonly requiredScope: AuthEnvironmentScope }) {
    super({
      message: props.message.slice(0, AUTH_ERROR_MESSAGE_MAX_LENGTH),
      requiredScope: props.requiredScope,
    } as any);
  }
}

export const AuthAccessStreamClientUpsertedEvent = Schema.Struct({
  version: Schema.Literal(1),
  revision: NonNegativeInt,
  type: Schema.Literal("clientUpserted"),
  payload: AuthClientSession,
});
export type AuthAccessStreamClientUpsertedEvent = typeof AuthAccessStreamClientUpsertedEvent.Type;

export const AuthAccessStreamClientRemovedEvent = Schema.Struct({
  version: Schema.Literal(1),
  revision: NonNegativeInt,
  type: Schema.Literal("clientRemoved"),
  payload: Schema.Struct({
    sessionId: AuthAccessSessionId,
  }),
});
export type AuthAccessStreamClientRemovedEvent = typeof AuthAccessStreamClientRemovedEvent.Type;

export const AuthAccessStreamEvent = Schema.Union([
  AuthAccessStreamSnapshotEvent,
  AuthAccessStreamPairingLinkUpsertedEvent,
  AuthAccessStreamPairingLinkRemovedEvent,
  AuthAccessStreamClientUpsertedEvent,
  AuthAccessStreamClientRemovedEvent,
]);
export type AuthAccessStreamEvent = typeof AuthAccessStreamEvent.Type;

export const AuthRevokePairingLinkInput = Schema.Struct({
  id: AuthIdentifier,
});
export type AuthRevokePairingLinkInput = typeof AuthRevokePairingLinkInput.Type;

export const AuthRevokeClientSessionInput = Schema.Struct({
  sessionId: AuthAccessSessionId,
});
export type AuthRevokeClientSessionInput = typeof AuthRevokeClientSessionInput.Type;

export const AuthCreatePairingCredentialInput = Schema.Struct({
  label: Schema.optionalKey(AuthClientLabel),
  scopes: Schema.optionalKey(AuthEnvironmentScopes),
});
export type AuthCreatePairingCredentialInput = typeof AuthCreatePairingCredentialInput.Type;

export const AuthSessionState = Schema.Struct({
  authenticated: Schema.Boolean,
  auth: ServerAuthDescriptor,
  scopes: Schema.optionalKey(AuthEnvironmentScopes),
  sessionMethod: Schema.optionalKey(ServerAuthSessionMethod),
  expiresAt: Schema.optionalKey(Schema.DateTimeUtc),
});
export type AuthSessionState = typeof AuthSessionState.Type;
